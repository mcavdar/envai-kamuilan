import os
from pymongo import MongoClient
from google import genai

mongo = MongoClient("mongodb://localhost:27017")
db = mongo["ilanlar_db"]

jobs = db["jobs"]


# Gemini
client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

def find_location(extract_result):
    first_posting = extract_result["job_postings"][0]
    prompt = f"""
You are extracting the location of a job announcement.

The announcement is from one organization, and all job postings
in this announcement are assumed to have the same location.

Organization:
{extract_result.get("organization_name")}

Announcement title:
{extract_result.get("announcement_title")}

Job title:
{first_posting.get("job_title")}

Job description:
{first_posting.get("job_description")}

Application details:
{extract_result.get("application_details")}

Contact information:
{extract_result.get("contact_information")}

Find the location where this job is located.

Return ONLY the location in this format:
City, District

For example:
Hatay, Reyhanlı

If the location cannot be determined reliably, return exactly:
NONE
"""
    response = client.models.generate_content(
        model="gemma-4-31b-it",
        contents=prompt,
    )
    location = response.text.strip()
    if location.upper() == "NONE":
        return None
    return location

for job in jobs.find():
    extract_result = job.get("extract_result")
    if not extract_result:
        continue
    postings = extract_result.get("job_postings", [])
    if not postings:
        continue
    # First posting only
    first_posting = postings[0]
    # Already has a location -> don't call LLM
    if first_posting.get("location") is not None:
        continue
    location = find_location(extract_result)
    print(
        job["_id"],
        "|",
        extract_result.get("organization_name"),
        "|",
        first_posting.get("job_title"),
        "=>",
        location
    )
    # LLM couldn't determine location
    if not location:
        continue
    # Apply same location to ALL postings
    for posting in postings:
        posting["location"] = location
    jobs.update_one(
        {"_id": job["_id"]},
        {
            "$set": {
                "extract_result.job_postings": postings
            }
        }
    )
