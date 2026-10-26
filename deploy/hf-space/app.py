import requests
import gradio as gr
import pandas as pd


PAPER_STATUS_URL = "https://pay-hk.ashesborn.cloud/api/v1/judge/paper"
PAID_JUDGE_URL = "https://pay.ashesborn.cloud/api/v1/judge"
FOOTER = (
    f"The full verdict (`CONTESTED` / `SUPPORTED` / `INSUFFICIENT_EVIDENCE`), "
    f"confidence, and evidence path come from the paid endpoint "
    f"[{PAID_JUDGE_URL}]({PAID_JUDGE_URL}) "
    "($0.02 / $0.10 per call, x402). This free status view does not infer a verdict."
)


def _format_response(params):
    try:
        response = requests.get(PAPER_STATUS_URL, params=params, timeout=20)
    except requests.Timeout:
        return "The status service took too long to respond. Please try again.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER
    except requests.RequestException:
        return "The status service could not be reached. Please try again later.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER

    if response.status_code == 404:
        message = "No matching paper was found in the published dataset."
        return message, pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER
    if response.status_code == 503:
        message = "The status data is temporarily unavailable because no published snapshot is active. Please try again later."
        return message, pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER
    if response.status_code != 200:
        return "The status service returned an unexpected response. Please try again later.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER

    try:
        payload = response.json()
    except (TypeError, ValueError):
        return "The status service returned unreadable data. Please try again later.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER

    if not isinstance(payload, dict):
        return "The status service returned unreadable data. Please try again later.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER
    paper = payload.get("paper") or {}
    if not isinstance(paper, dict) or not paper:
        return "No matching paper was found in the published dataset.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER
    title = paper.get("title") or "Untitled paper"
    year = paper.get("year") or "Year unavailable"
    doi = paper.get("doi") or "DOI unavailable"
    header = f"## {title} ({year})\n\n**DOI:** {doi}"
    statuses = payload.get("statuses") or []
    if not isinstance(statuses, list):
        statuses = []
    statuses = [item for item in statuses if isinstance(item, dict)]
    rows = [
        {
            "source": item.get("source", ""),
            "tier": item.get("source_tier", ""),
            "retracted": bool(item.get("is_retracted", False)),
            "date": item.get("retraction_date") or "",
        }
        for item in statuses
    ]
    tier_order = {"A": 0, "B": 1, "C": 2, "D": 3}
    rows.sort(key=lambda row: (tier_order.get(row["tier"], 4), row["source"]))
    table = pd.DataFrame(rows, columns=["source", "tier", "retracted", "date"])
    sources = {item.get("source") for item in statuses if item.get("source")}
    asserting = {item.get("source") for item in statuses if item.get("source") and item.get("is_retracted")}
    summary = f"{len(asserting)} of {len(sources)} sources assert a retraction"
    return header, table, summary, FOOTER


def retraction_status(doi: str = "", paper_id: str = ""):
    """Show free retraction status for exactly one DOI or OpenAlex paper ID."""
    doi = (doi or "").strip()
    paper_id = (paper_id or "").strip()
    if bool(doi) == bool(paper_id):
        return "Enter exactly one DOI or OpenAlex paper ID.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER
    key, value = ("doi", doi) if doi else ("paper_id", paper_id)
    return _format_response({key: value})


def paper_status_by_openalex_id(paper_id: str):
    """Show free retraction status for an OpenAlex paper ID such as W2117847125."""
    paper_id = (paper_id or "").strip()
    if not paper_id:
        return "Enter an OpenAlex paper ID, such as W2117847125.", pd.DataFrame(columns=["source", "tier", "retracted", "date"]), "", FOOTER
    return _format_response({"paper_id": paper_id})


with gr.Blocks(title="Retraction status") as demo:
    gr.Markdown("# Free retraction status\nLook up a paper in the published integrity dataset.")
    with gr.Row():
        doi = gr.Textbox(label="DOI", placeholder="10.1016/S0140-6736(97)11096-0")
        paper_id = gr.Textbox(label="OpenAlex paper ID (optional)", placeholder="W2117847125")
    lookup = gr.Button("Check status", variant="primary")
    result = gr.Markdown()
    table = gr.Dataframe(headers=["source", "tier", "retracted", "date"], label="Reported statuses", interactive=False)
    summary = gr.Markdown()
    footer = gr.Markdown()
    lookup.click(retraction_status, inputs=[doi, paper_id], outputs=[result, table, summary, footer], api_name="retraction_status")
    # Hidden UI control registers a dedicated OpenAlex-ID MCP/API function.
    openalex_lookup = gr.Button(visible=False)
    openalex_lookup.click(paper_status_by_openalex_id, inputs=paper_id, outputs=[result, table, summary, footer], api_name="paper_status_by_openalex_id")


if __name__ == "__main__":
    demo.launch(mcp_server=True)
