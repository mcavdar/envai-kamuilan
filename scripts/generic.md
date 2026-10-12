{
  "name": "a-generic-schema-for-turkish-job-announcement-and-recruitmen",
  "parameters": {
    "target_pages": null,
    "max_pages": null,
    "tier": "cost_effective",
    "version": "latest",
    "data_schema": {
      "description": "A generic schema for Turkish job announcement and recruitment documents, suitable for university, public-sector, military, and private-sector recruitment.",
      "type": "object",
      "properties": {
        "announcement_id": {
          "description": "A unique identifier for the job announcement, if available.",
          "type": "string"
        },
        "announcement_title": {
          "description": "The main title or subject of the job announcement.",
          "type": "string"
        },
        "datePosted": {
          "description": "The date when the announcement was officially issued. Format: YYYY-MM-DD.",
          "type": "string"
        },
        "organization_name": {
          "description": "The name of the organization, institution, or employer issuing the announcement.",
          "type": "string"
        },
        "job_postings": {
          "description": "A list of individual job positions or roles being announced.",
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "job_title": {
                "description": "The specific title of the job position (e.g., 'Araştırma Görevlisi', 'Yazılım Mühendisi').",
                "type": "string"
              },
              "department": {
                "description": "The department, unit, or faculty where the job position is located.",
                "type": "string"
              },
              "number_of_positions": {
                "description": "The number of available positions for this specific job title.",
                "type": "number"
              },
              "jobLocation": {
                "description": "The physical location of the job (e.g., şehir, kampüs, belirli adres).",
                "type": "string"
              },
              "job_description": {
                "description": "A detailed description of the job responsibilities and duties.",
                "type": "string"
              },
              "qualifications": {
                "description": "A list of general qualifications required for this specific job (e.g., eğitim düzeyi, öğrenim alanı, deneyim, beceriler).",
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "specific_requirements": {
                "description": "A list of specific or additional requirements for this particular job posting, beyond general qualifications.",
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "salary_information": {
                "description": "Information regarding salary or pay grade for this position, if specified.",
                "type": "string"
              },
              "additional_job_attributes": {
                "description": "Any other uncommon or job-specific attributes not covered by other fields.",
                "type": "object",
                "properties": {},
                "required": [],
                "additionalProperties": false
              }
            },
            "required": [
              "job_title",
              "number_of_positions"
            ],
            "additionalProperties": false
          }
        },
        "application_url": {
          "description": "The URL for the online application portal or platform.",
          "type": "string"
        },
        "application_method": {
          "description": "The method(s) by which applications can be submitted (e.g., 'Çevrimiçi', 'Posta', 'Şahsen', 'E-posta').",
          "type": "string"
        },
        "application_period": {
          "description": "A descriptive text indicating the overall application period, if available.",
          "type": "string"
        },
        "application_start_date": {
          "description": "The start date for submitting applications. Format: YYYY-MM-DD.",
          "type": "string"
        },
        "application_end_date": {
          "description": "The end date for submitting applications. Format: YYYY-MM-DD.",
          "type": "string"
        },
        "application_deadline": {
          "description": "The specific deadline for applications, including time if specified. Format: YYYY-MM-DD HH:MM or descriptive text.",
          "type": "string"
        },
        "application_details": {
          "description": "General instructions or important details regarding the application process.",
          "type": "string"
        },
        "application_process": {
          "description": "A step-by-step description of the application submission process.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "required_documents": {
          "description": "A list of documents that must be submitted with the application.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "general_requirements": {
          "description": "A list of general conditions or eligibility criteria applicable to all applicants.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "special_requirements": {
          "description": "A list of specific or additional requirements that may apply to certain roles or applicant groups.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "employment_type": {
          "description": "The general type of employment offered (e.g., 'Tam zamanlı', 'Yarı zamanlı', 'Sözleşmeli', 'Kadrolu').",
          "type": "string"
        },
        "evaluation_process": {
          "description": "A description of the stages and methods used for evaluating applicants (e.g., ön değerlendirme, mülakatlar, sınavlar).",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "exam_details": {
          "description": "Details regarding any required exams for the recruitment process.",
          "type": "object",
          "properties": {
            "exam_type": {
              "description": "The type of exam (e.g., 'Yazılı Sınav', 'Sözlü Sınav', 'Uygulamalı Sınav').",
              "type": "string"
            },
            "exam_date": {
              "description": "The date of the exam. Format: YYYY-MM-DD.",
              "type": "string"
            },
            "exam_time": {
              "description": "The time of the exam. Format: HH:MM.",
              "type": "string"
            },
            "exam_location": {
              "description": "The location where the exam will be held.",
              "type": "string"
            },
            "exam_content": {
              "description": "Topics or subjects covered in the exam.",
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "exam_notes": {
              "description": "Any other important notes or instructions regarding the exam.",
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          },
          "required": [
            "exam_type",
            "exam_date",
            "exam_time",
            "exam_location",
            "exam_content",
            "exam_notes"
          ],
          "additionalProperties": false
        },
        "contact_information": {
          "description": "Contact details for inquiries regarding the announcement.",
          "type": "object",
          "properties": {
            "person_name": {
              "description": "Name of the contact person.",
              "type": "string"
            },
            "department": {
              "description": "Department or unit to contact.",
              "type": "string"
            },
            "phone": {
              "description": "Contact phone number.",
              "type": "string"
            },
            "email": {
              "description": "Contact email address.",
              "type": "string"
            },
            "address": {
              "description": "Physical address for contact or inquiries.",
              "type": "string"
            },
            "website": {
              "description": "Relevant website for more information.",
              "type": "string"
            }
          },
          "required": [
            "person_name",
            "department",
            "phone",
            "email",
            "address",
            "website"
          ],
          "additionalProperties": false
        },
        "legal_basis": {
          "description": "The legal articles, laws, or regulations on which the announcement is based.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "important_notes": {
          "description": "A list of general important notes or disclaimers related to the announcement.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "additional_notes": {
          "description": "Any other supplementary notes or information not covered elsewhere.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "additional_attributes": {
          "description": "A flexible field for any uncommon or announcement-specific information not captured by the predefined fields.",
          "type": "object",
          "properties": {},
          "required": [],
          "additionalProperties": false
        }
      },
      "required": [
        "announcement_title",
        "organization_name",
        "job_postings"
      ],
      "additionalProperties": false
    },
    "extraction_target": "per_doc",
    "system_prompt": null,
    "cite_sources": false,
    "confidence_scores": false,
    "granular_bboxes": [],
    "parse_tier": null,
    "parse_config_id": null,
    "extract_version": "latest"
  }
}
