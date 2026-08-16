#!/usr/bin/env bash

set -Eeuo pipefail

###############################################################################
# Load environment variables
###############################################################################
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    echo "ERROR: .env file not found."
    exit 1
fi

set -a
source "$SCRIPT_DIR/.env"
set +a

: "${LLAMAINDEX_BASE_URL:?Missing LLAMAINDEX_BASE_URL}"
: "${LLAMAINDEX_API_KEY:?Missing LLAMAINDEX_API_KEY}"
: "${GOOGLE_API_URL:?Missing GOOGLE_API_URL}"
: "${GOOGLE_MODEL:?Missing GOOGLE_MODEL}"
: "${GEMINI_API_KEY:?Missing GEMINI_API_KEY}"
: "${MONGO_CONTAINER:?Missing MONGO_CONTAINER}"
: "${MONGO_DB:?Missing MONGO_DB}"

###############################################################################
# Go to project directory
###############################################################################
cd /home/mc/docker-files/kpss_alim

last=$(printf '%s\n' *.html | sort | tail -n1)

mkdir -p "data/${last%.html}"

###############################################################################
# Backup existing jobs collection
###############################################################################
sudo docker exec -i "$MONGO_CONTAINER" mongosh --eval \
'db.getSiblingDB("'"$MONGO_DB"'").jobs.renameCollection("jobs_backup1020")'

###############################################################################
# Download only new PDFs
###############################################################################
awk '/ContentColumn/ {found=1} found' "$last" |
grep "<a href='ilanDetay.aspx?kod=[^']*'" -o |
grep "'.*'" -o |
sed "s|^'|'https://kamuilan.sbb.gov.tr/|g" |
xargs -n1 -I{} bash -c '

file_name=$(curl --fail -Is \
    -H "Referer: https://kamuilan.sbb.gov.tr/arsiv.aspx" "{}" |
    grep -i "Content-Disposition" |
    sed -n "s/.*filename=\(.*\)$/\1/p")

echo "$file_name"

escaped_file_name=$(
printf "%s" "$file_name" |
tr -d "\r\n" |
sed "s/[\"\\]/\\&/g"
)

row_count=$(
sudo docker exec -i "'"$MONGO_CONTAINER"'" \
mongosh "'"$MONGO_DB"'" \
--quiet \
--eval "db.jobs_backup1020.countDocuments({file_name:\"$escaped_file_name\"})"
)

if [[ "$row_count" -gt 0 ]]; then

    echo "Already processed ($row_count record(s))."

    sudo docker exec -i "'"$MONGO_CONTAINER"'" \
    mongosh "'"$MONGO_DB"'" \
    --quiet \
    --eval "
        db.jobs_backup1020.find({
            file_name: \"$escaped_file_name\"
        }).forEach(function(doc){
            db.jobs.insertOne(doc);
        });
    "

else

    echo "New PDF."

    file_part=$(echo "{}" | sed "s|/|_|g")
    file_out="data/'"${last%.html}"'/${file_part}.pdf"

    echo "$file_out"

    curl --fail \
        -H "Referer: https://kamuilan.sbb.gov.tr/arsiv.aspx" \
        "{}" \
        -o "$file_out"

    sleep "'"$DOWNLOAD_DELAY"'"

fi
'

###############################################################################
# Go into working directory
###############################################################################
cd "/home/mc/docker-files/kpss_alim/data/${last%.html}"

mkdir -p big-pdfs done problem parsed final

###############################################################################
# Upload PDFs to LlamaIndex
###############################################################################
for file in *.pdf; do

    pages=$(pdfinfo "$file" | awk -F: "/Pages/ {print \$2}" | xargs)

    if [[ "$pages" -gt 40 ]]; then
        echo "$file has $pages pages."
        mv "$file" big-pdfs
        continue
    fi

    echo "Uploading $file"

    sleep "$UPLOAD_DELAY"

    output_file="${file%.pdf}.txt"

    curl --fail \
        --retry 3 \
        --retry-delay 5 \
        -X POST \
        "$LLAMAINDEX_BASE_URL/api/parsing/upload" \
        -H "accept: application/json" \
        -H "Authorization: Bearer $LLAMAINDEX_API_KEY" \
        -F 'parse_mode=parse_page_with_llm' \
        -F "file=@$file;type=application/pdf" \
        -F "language=tr" \
        -o "$output_file"

done

###############################################################################
# Wait for parsing
###############################################################################
sleep "$LLAMA_WAIT_SECONDS"

###############################################################################
# Download markdown
###############################################################################
for file in *.txt; do

    sleep "$UPLOAD_DELAY"

    echo "Checking $file"

    output_file="${file%.txt}.md"

    file_id=$(jq -r '.id' "$file")

    job_status=$(
    curl --fail \
        "$LLAMAINDEX_BASE_URL/api/v1/parsing/job/$file_id" \
        -H "accept: application/json" \
        -H "Authorization: Bearer $LLAMAINDEX_API_KEY"
    )

    status=$(echo "$job_status" | jq -r '.status')

    if [[ "$status" == "SUCCESS" ]]; then

        echo "Download markdown"

        curl --fail \
            "$LLAMAINDEX_BASE_URL/api/v1/parsing/job/$file_id/result/raw/markdown" \
            -H "accept: application/json" \
            -H "Authorization: Bearer $LLAMAINDEX_API_KEY" \
            -o "$output_file"

        rm "$file"
        mv "${file%.txt}.pdf" parsed

    else

        echo "Parsing failed"

        mv "${file%.txt}.pdf" problem
        mv "$file" problem

    fi

done

###############################################################################
# Gemini extraction
###############################################################################
for file in *.md; do

    echo "Processing $file"

    file_content=$(<"$file")
    output_file="${file%.md}.json"

    http_code=$(
    curl -s \
        --fail \
        "$GOOGLE_API_URL/models/$GOOGLE_MODEL:generateContent?key=$GEMINI_API_KEY" \
        -H "Content-Type: application/json" \
        -o "$output_file" \
        -w "%{http_code}" \
        -X POST \
        -d "$(
            jq -n \
            --arg text "$file_content" \
            --arg prefix "Aşağıdaki metinden tüm iş tanımlarını çıkarın..." \
            '{
                contents:[
                    {
                        parts:[
                            {
                                text:($prefix+$text)
                            }
                        ]
                    }
                ],
                generationConfig:{
                    maxOutputTokens:8192,
                    responseMimeType:"application/json",
                    temperature:0.1
                }
            }'
        )"
    )

    if [[ "$http_code" == "200" ]]; then
        mv "$file" done
    else
        mv "$file" problem
    fi

    sleep "$GOOGLE_DELAY"

done

###############################################################################
# Import into MongoDB
###############################################################################
for file in *.json; do

    echo "Importing $file"

    output_file="${file%.json}"

    output_file2=$(echo "$output_file" |
        sed "s|https:__kamuilan.sbb.gov.tr_|https://kamuilan.sbb.gov.tr/|g")

    file_name=$(
    curl --fail -I \
        -H "Referer: https://kamuilan.sbb.gov.tr/arsiv.aspx" \
        "$output_file2" |
        grep -i "Content-Disposition" |
        sed -n "s/.*filename=\(.*\)$/\1/p"
    )

    escaped_file_name=$(
    printf "%s" "$file_name" |
    tr -d "\r\n" |
    sed "s/[\"\\]/\\&/g"
    )

    new_json=$(
        jq -r '
            .candidates[0].content.parts[]
            | select(.thought != true)
            | .text? // empty
        ' "$file" |
        jq 'map(. + {file_name:"'"$escaped_file_name"'"})' |
        jq 'map(. + {file_url:"'"$file"'"})'
    )

    sudo docker exec -i "$MONGO_CONTAINER" \
    mongosh "$MONGO_DB" \
    --quiet \
    --eval "db.jobs.insertMany($new_json)"

    mv "$file" final

done