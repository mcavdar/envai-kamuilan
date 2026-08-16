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



# ### Run only for incremental update without renameCollection
# awk '/ContentColumn/ {found=1} found' "$last" | 
# grep "<a href='ilanDetay.aspx?kod=[^']*'" -o |
# grep "'.*'" -o  | 
# sed "s|^'|'https://kamuilan.sbb.gov.tr/|g" |
# xargs -n 1 -I {} sh -c '

# file_name=$(curl -Is -H "Referer: https://kamuilan.sbb.gov.tr/arsiv.aspx" "{}" |
    # grep -i "Content-Disposition" | 
    # sed -n "s/.*filename=\(.*\)$/\1/p")

# echo "$file_name"


# escaped_file_name=$(
# printf "%s" "$file_name" |
# tr -d "\r\n" |
# sed "s/[\"\\]/\\&/g"
# )

# echo "$escaped_file_name"
# row_count=$(sudo docker exec -i mongo_ilanlar mongosh ilanlar_db --quiet --eval "db.jobs.countDocuments({ file_name: \"$escaped_file_name\" })")
# if [ "$row_count" -gt 0 ]; then
  # echo "File name found: $row_count row(s) found."
# else
  # echo "Its a new file. lets extract data"
  # file_part=$(echo "{}" | sed "s|/|_|g")
  # file_out="data/${2%.html}/${file_part}.pdf"  
  # echo $file_out
  # curl -H "Referer: https://kamuilan.sbb.gov.tr/arsiv.aspx" "{}" --max-time 150 -o "$file_out"
  # sleep 1
# fi
# ' _ "{}" "$last"
# ###


###############################################################################
# Backup existing jobs collection
###############################################################################
sudo docker exec -i "$MONGO_CONTAINER" mongosh --eval \
'db.getSiblingDB("'"$MONGO_DB"'").jobs.renameCollection("jobs_backup1021")'

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
--eval "db.jobs_backup1021.countDocuments({file_name:\"$escaped_file_name\"})"
)

if [[ "$row_count" -gt 0 ]]; then

    echo "Already processed ($row_count record(s))."

    sudo docker exec -i "'"$MONGO_CONTAINER"'" \
    mongosh "'"$MONGO_DB"'" \
    --quiet \
    --eval "
        db.jobs_backup1021.find({
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



	curl  --fail \
			--retry 3 \
			--retry-delay 5 \
			-X POST \
	  "$LLAMAINDEX_BASE_URL/api/v1/beta/files" \
	  -H "Content-Type: multipart/form-data" \
	  -H "Authorization: Bearer $LLAMAINDEX_API_KEY" \
	  -F "file=@$file;type=application/pdf" \
	  -F purpose="extract" \
        -o "$output_file"

done









for file in *.txt; do

    sleep "$UPLOAD_DELAY"

    echo "Checking $file"

    output_file="${file%.txt}.json"

    file_id=$(jq -r '.id' "$file")
    project_id=$(jq -r '.project_id' "$file")

  
    parameters=$(jq -r '.parameters' /home/mc/repos/kpss/generic.md)


    curl -X POST \
      "$LLAMAINDEX_BASE_URL/api/v2/extract?project_id=$project_id" \
      -H "accept: application/json" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $LLAMAINDEX_API_KEY" \
      -d "$(jq -n \
            --arg file_input "$file_id" \
            --argjson configuration "$parameters" \
            '{file_input: $file_input, configuration: $configuration}')" \
        -o "$output_file"


done

sleep 100

for file in *.txt; do

    sleep "$UPLOAD_DELAY"

    echo "Checking $file"

    output_file="${file%.txt}.json"

    project_id=$(jq -r '.project_id' "$file")

  
    job_id=$(jq -r '.id' "$output_file")

	
	curl -X 'GET' \
  "$LLAMAINDEX_BASE_URL/api/v2/extract/$job_id?project_id=$project_id" \
  -H "accept: application/json" \
  -H "Authorization: Bearer $LLAMAINDEX_API_KEY" \
   -o "$output_file"

done




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
	jq '. + {file_name:"'"$escaped_file_name"'"} + {file_url:"'"$file"'"}' "$file"
	)


    sudo docker exec -i "$MONGO_CONTAINER" \
    mongosh "$MONGO_DB" \
    --quiet \
    --eval "db.jobs.insertOne($new_json)"

    mv "$file" final

done




# jq '.extract_result | keys' *.json
# see fields from json

# common fields:
# announcement_id
# announcement_title
# announcement_date
# organization_name
# job_postings
# application_url
# application_method
# application_period
# application_deadline
# general_requirements
# required_documents
# legal_basis
# employment_type
# evaluation_process
# contact_information
# additional_notes
# additional_attributes








# for file in *.txt; do

    # sleep "$UPLOAD_DELAY"

    # echo "Checking $file"

    # output_file="${file%.txt}.md"

    # file_id=$(jq -r '.id' "$file")
    # project_id=$(jq -r '.project_id' "$file")

  
  # curl -X POST \
  # "$LLAMAINDEX_BASE_URL/api/v2/extract/schema/generate?project_id=$project_id" \
  # -H "accept: application/json" \
  # -H "Authorization: Bearer $LLAMAINDEX_API_KEY" \
  # -H "Content-Type: application/json" \
  # -d "{
    # \"prompt\": \"Generate a comprehensive extraction schema for job announcement PDFs. Include common fields shared across most job postings and allow for an extensible section (e.g., additional_attributes) to capture uncommon or organization-specific requirements. The schema should be optimized for downstream storage in MongoDB and support filtering, analytics, and semantic search.\",
    # \"file_id\": \"$file_id\"
  # }"   \
        # -o "$output_file"

        # mv "${file%.txt}.pdf" parsed

# done
