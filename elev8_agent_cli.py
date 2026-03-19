#!/usr/bin/env python3
"""
ELEV8 DIGITAL — Agent CLI
Called by elev8_bot.js with JSON payload.
Usage: python3 elev8_agent_cli.py '{"service":"cv","name":"John",...}'
Prints PDF path as last line of output.
"""

import sys, json, os, time, requests
from datetime import datetime

API_KEY = "YOUR_GROQ_API_KEY"
MODEL   = "llama-3.3-70b-versatile"
API_URL = "https://api.groq.com/openai/v1/chat/completions"
OUTPUT_DIR = os.path.expanduser("~/elev8_outputs")

# ── PROMPTS ──────────────────────────────────────────────────

CV_SYSTEM = """You are a senior South African CV writer and HR professional.
Write ATS-optimized, professional documents for the SA job market.
Use action verbs. Understand TVET/Matric/learnership contexts.
Output plain text only. No markdown symbols like ## or **."""

CV_PROMPT = """Create a complete professional job application package.

APPLICANT:
Name: {name} | Phone: {phone} | Email: {email} | Location: {location}
Role: {role} | Company: {company} | Experience: {experience} yrs
Skills: {skills} | Education: {education}
Previous work: {prev_jobs} | Extra: {extra}

Write exactly 3 sections with these exact headers:

CURRICULUM VITAE
Header: name, phone, email, location
Professional Summary (3 strong lines showing value)
Core Skills (6-8 points)
Work Experience (action verbs, 2 achievement points per role)
Education
References: Available on request

COVER LETTER
To Hiring Manager at {company}.
Paragraph 1: Who you are and the role
Paragraph 2: Why you are right (2 specific examples)
Paragraph 3: Request interview. Show commitment.
Under 250 words. Confident. South African English.

APPLICATION MESSAGE
WhatsApp message to send with CV attachment.
6-8 lines. Greeting, role, one key strength, CV attached, contact info."""

CONTENT_SYSTEM = """You are a South African digital marketing copywriter.
Write for local businesses. Human, local, scroll-stopping.
Plain text only. No markdown. No hashtag spam."""

CONTENT_PROMPT = """Create a complete content pack for {business} promoting {product}.
Audience: {audience}. Tone: {tone}.

SOCIAL MEDIA CAPTIONS
Caption 1 - Facebook (80-120 words, 5 hashtags)
Caption 2 - WhatsApp Status (3 punchy lines, 1 call to action)
Caption 3 - Instagram or TikTok (short, 8 hashtags)

AD COPY
Short ad (30 words for WhatsApp or SMS)
Medium ad (80 words for Facebook)
5 headline options (max 10 words each)

POSTER TEXT LAYOUT
Structured text layout showing headline, subheadline, 3 benefits, CTA, contact
Plus 3 headline variations and 3 tagline options"""

REPLY_SYSTEM = """You are a South African business communication expert.
Write WhatsApp messages for small businesses. Warm, professional.
No corporate language. Plain text only."""

REPLY_PROMPT = """Create a WhatsApp auto-reply template set for {business} ({service}).

7 templates, each clearly labeled:

1. GREETING - First message to new customer (warm welcome, explain what you offer)
2. PRICING - Reply when asked how much (be clear, build value)
3. AVAILABILITY - Reply when asked if available
4. BOOKING CONFIRMED - After order or appointment confirmed
5. THANK YOU - After payment received
6. FOLLOW-UP - 3 days after service, check satisfaction
7. COMPLAINT - When customer is unhappy (acknowledge, apologise, offer solution)

Each template under 80 words. Warm. South African context. Ready to copy-paste."""


# ── AI CALL ──────────────────────────────────────────────────

def call_ai(prompt, system, max_tokens=1400):
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt}
        ],
        "max_tokens":  max_tokens,
        "temperature": 0.72
    }
    for attempt in range(1, 4):
        try:
            r = requests.post(API_URL, headers=headers, json=payload, timeout=90)
            if r.status_code == 429:
                time.sleep(15); continue
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"].strip()
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(5)
    raise Exception("AI call failed after 3 attempts")


# ── PDF ──────────────────────────────────────────────────────

def save_pdf(content, filename, title):
    try:
        from fpdf import FPDF
    except ImportError:
        return None

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, filename)

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(15, 15, 15)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "ELEV8 DIGITAL", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(0, 5, "We elevate your business. Elev8", new_x="LMARGIN", new_y="NEXT", align="C")
    pdf.ln(2)
    pdf.line(15, pdf.get_y(), 195, pdf.get_y())
    pdf.ln(4)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, title, new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)

    for line in content.split("\n"):
        line = (line.rstrip()
                .replace("\u2022","-").replace("\u2713","+").replace("\u2192",">")
                .replace("\u2705","[ok]").replace("\u26a0","[!]")
                .replace("\u2018","'").replace("\u2019","'")
                .replace("\u201c",'"').replace("\u201d",'"')
                .replace("\u2014","-").replace("\u2013","-")
                .replace("###","").replace("##","").replace("**",""))
        line = line.encode('latin-1', 'replace').decode('latin-1')

        if line.startswith("==") or line.startswith("--"):
            pdf.line(15, pdf.get_y(), 195, pdf.get_y()); pdf.ln(3); continue
        if line.strip() == "":
            pdf.ln(2); continue
        if line.isupper() and 2 < len(line.strip()) < 60:
            pdf.set_font("Helvetica", "B", 10)
        else:
            pdf.set_font("Helvetica", "", 10)
        try:
            pdf.multi_cell(180, 6, line)
        except Exception:
            pass

    pdf.set_y(-15)
    pdf.set_font("Helvetica", "I", 7)
    pdf.cell(0, 10,
        f"ELEV8 DIGITAL | {datetime.now().strftime('%d %b %Y %H:%M')} | Page {pdf.page_no()}",
        align="C")
    pdf.output(path)
    return path


# ── SERVICES ─────────────────────────────────────────────────

def ts():
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def run_cv(data):
    content = call_ai(
        CV_PROMPT.format(**data),
        system=CV_SYSTEM,
        max_tokens=1600
    )
    name  = data.get("name","client").replace(" ","_")
    fname = f"cv_package_{name}_{ts()}.pdf"
    title = f"CV Package - {data.get('name','')}"
    return save_pdf(content, fname, title)

def run_content(data):
    content = call_ai(
        CONTENT_PROMPT.format(**data),
        system=CONTENT_SYSTEM,
        max_tokens=1100
    )
    biz   = data.get("business","biz").replace(" ","_")
    fname = f"content_{biz}_{ts()}.pdf"
    title = f"Content Pack - {data.get('business','')}"
    return save_pdf(content, fname, title)

def run_replies(data):
    content = call_ai(
        REPLY_PROMPT.format(**data),
        system=REPLY_SYSTEM,
        max_tokens=900
    )
    biz   = data.get("business","biz").replace(" ","_")
    fname = f"replies_{biz}_{ts()}.pdf"
    title = f"Reply Templates - {data.get('business','')}"
    return save_pdf(content, fname, title)


# ── MAIN ─────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 elev8_agent_cli.py '{json payload}'")
        sys.exit(1)

    try:
        payload = json.loads(sys.argv[1])
        service = payload.pop("service")

        if service == "cv":
            # Fill defaults for optional fields
            payload.setdefault("email", "Not provided")
            payload.setdefault("prev_jobs", "No formal experience")
            payload.setdefault("extra", "None")
            path = run_cv(payload)

        elif service == "content":
            payload.setdefault("tone", "professional")
            path = run_content(payload)

        elif service == "replies":
            path = run_replies(payload)

        else:
            print(f"Unknown service: {service}")
            sys.exit(1)

        if path:
            print(f"PDF:{path}")
        else:
            print("ERROR:PDF generation failed")
            sys.exit(1)

    except Exception as e:
        print(f"ERROR:{e}")
        sys.exit(1)
