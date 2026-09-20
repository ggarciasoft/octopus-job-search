"""Job normalisation: raw connector or page data -> ``NormalizedJob``."""

from .html_text import entity_encoded_html_to_text, html_title, html_to_text, plain_text
from .jobposting import JobPostingExtraction, extract_job_postings, normalize_url, url_identity
from .normalize import (
    NORMALIZER_VERSION,
    NormalizedResult,
    RawJob,
    RawLocation,
    RawSalary,
    RawSection,
    compute_content_hash,
    make_warning,
    normalize_job,
)

__all__ = [
    "NORMALIZER_VERSION",
    "JobPostingExtraction",
    "NormalizedResult",
    "RawJob",
    "RawLocation",
    "RawSalary",
    "RawSection",
    "compute_content_hash",
    "entity_encoded_html_to_text",
    "extract_job_postings",
    "html_title",
    "html_to_text",
    "make_warning",
    "normalize_job",
    "normalize_url",
    "plain_text",
    "url_identity",
]
