#!/usr/bin/env python3
"""
Werkwijze PDF Generator — Legal Mind Huisstijl
Genereert professionele werkwijze-documenten voor interne skill-documentatie.

Design: donker/licht afwisseling per pagina.
- Pagina 1 (donker): Cover + overzicht (doel, wanneer wel/niet) op één pagina
- Pagina 2 (licht): Stappen 1-3
- Pagina 3 (donker): Stappen 4-6
- Pagina 4 (licht): Stappen 7-9 / of tips
- Etc. afwisselend
- Laatste pagina: Tips (volgt het afwisselingspatroon)
"""

import json
import argparse
import os
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

# ── Legal Mind Kleuren ──────────────────────────────────────────────────────
ORANJE = HexColor("#E86832")
DONKER = HexColor("#2B2B2B")
DIEP_DONKER = HexColor("#1E1E1E")
LICHT_BG = HexColor("#F5F1EE")
CARD_DONKER = HexColor("#3A3A3A")
CARD_LICHT = HexColor("#EDEDED")
CARD_WARM = HexColor("#F0ECE8")
TEKST_DONKER = HexColor("#2B2B2B")
TEKST_GRIJS = HexColor("#666666")
TEKST_LICHT_GRIJS = HexColor("#999999")
FOOTER_GRIJS = HexColor("#999999")
WIT = HexColor("#FFFFFF")
LICHT_TEKST = HexColor("#E0E0E0")

PAGE_W, PAGE_H = A4
MARGIN = 25 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

STAPPEN_PER_PAGINA = 3


def _get_datum():
    """Geeft de huidige datum in het Nederlands."""
    return datetime.now().strftime("%d %B %Y").replace(
        "January", "januari").replace("February", "februari").replace(
        "March", "maart").replace("April", "april").replace(
        "May", "mei").replace("June", "juni").replace(
        "July", "juli").replace("August", "augustus").replace(
        "September", "september").replace("October", "oktober").replace(
        "November", "november").replace("December", "december")


# ═══════════════════════════════════════════════════════════════════════════
# PAGINA 1: DONKERE COVER + OVERZICHT
# ═══════════════════════════════════════════════════════════════════════════

def draw_cover_with_overview(c, data):
    """Pagina 1 (donker): Cover met skill-naam + overzicht (doel, triggers, niet-triggers)."""
    # Donkere achtergrond
    c.setFillColor(DONKER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=True, stroke=False)

    # Decoratieve oranje curves rechtsboven
    c.setStrokeColor(ORANJE)
    c.setLineWidth(2.5)
    path = c.beginPath()
    path.moveTo(PAGE_W - 60 * mm, PAGE_H)
    path.curveTo(PAGE_W - 30 * mm, PAGE_H - 40 * mm,
                 PAGE_W + 10 * mm, PAGE_H - 80 * mm,
                 PAGE_W, PAGE_H - 120 * mm)
    c.drawPath(path, fill=0, stroke=1)

    c.setLineWidth(1.2)
    path2 = c.beginPath()
    path2.moveTo(PAGE_W - 40 * mm, PAGE_H)
    path2.curveTo(PAGE_W - 10 * mm, PAGE_H - 50 * mm,
                  PAGE_W + 20 * mm, PAGE_H - 90 * mm,
                  PAGE_W, PAGE_H - 140 * mm)
    c.drawPath(path2, fill=0, stroke=1)

    # Logo-tekst linksboven
    c.setFillColor(WIT)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(MARGIN, PAGE_H - 35 * mm, "legal mind")

    # Label: WERKWIJZE
    y = PAGE_H - 70 * mm
    c.setFillColor(ORANJE)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, y, "WERKWIJZE")
    c.setStrokeColor(ORANJE)
    c.setLineWidth(2)
    c.line(MARGIN, y - 4 * mm, MARGIN + 40 * mm, y - 4 * mm)

    # Skill naam (grote titel)
    y -= 20 * mm
    title = data.get("skill_name", "Skill")
    c.setFillColor(WIT)
    font_size = 30 if len(title) <= 25 else 24
    c.setFont("Helvetica-Bold", font_size)
    c.drawString(MARGIN, y, title)

    # Doel (subtitel onder de titel)
    doel = data.get("doel", "")
    if doel:
        y -= 12 * mm
        c.setFillColor(LICHT_TEKST)
        c.setFont("Helvetica", 10.5)
        lines = _wrap_text(c, doel, "Helvetica", 10.5, CONTENT_W - 40 * mm)
        for line in lines[:3]:
            c.drawString(MARGIN, y, line)
            y -= 4.5 * mm

    # ── Overzicht-sectie (onderste helft van de pagina) ──
    y -= 10 * mm

    # Wanneer gebruiken
    triggers = data.get("wanneer_gebruiken", [])
    if triggers:
        c.setFillColor(ORANJE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(MARGIN, y, "Wanneer gebruiken")
        y -= 7 * mm

        for item in triggers:
            lines = _wrap_text(c, item, "Helvetica", 9.5, CONTENT_W - 20 * mm)
            # Oranje bullet
            c.setFillColor(ORANJE)
            c.circle(MARGIN + 4 * mm, y + 1 * mm, 1.5 * mm, fill=True, stroke=False)
            # Tekst in wit
            c.setFillColor(WIT)
            c.setFont("Helvetica", 9.5)
            for i, line in enumerate(lines):
                c.drawString(MARGIN + 10 * mm, y - i * 4 * mm, line)
            y -= len(lines) * 4 * mm + 1.5 * mm

    # Wanneer NIET gebruiken
    niet = data.get("wanneer_niet", [])
    if niet:
        y -= 6 * mm
        c.setFillColor(ORANJE)
        c.setFont("Helvetica-Bold", 11)
        c.drawString(MARGIN, y, "Wanneer NIET gebruiken")
        y -= 7 * mm

        for item in niet:
            lines = _wrap_text(c, item, "Helvetica", 9.5, CONTENT_W - 20 * mm)
            c.setFillColor(TEKST_LICHT_GRIJS)
            c.circle(MARGIN + 4 * mm, y + 1 * mm, 1.5 * mm, fill=True, stroke=False)
            c.setFillColor(LICHT_TEKST)
            c.setFont("Helvetica", 9.5)
            for i, line in enumerate(lines):
                c.drawString(MARGIN + 10 * mm, y - i * 4 * mm, line)
            y -= len(lines) * 4 * mm + 1.5 * mm

    # Datum in label-blokje linksonder
    datum = _get_datum()
    c.setFillColor(CARD_DONKER)
    c.roundRect(MARGIN, 38 * mm, 55 * mm, 10 * mm, 2 * mm, fill=True, stroke=False)
    c.setFillColor(WIT)
    c.setFont("Helvetica", 9)
    c.drawString(MARGIN + 4 * mm, 41 * mm, datum)

    # Footer
    c.setFillColor(FOOTER_GRIJS)
    c.setFont("Helvetica", 9)
    c.drawString(MARGIN, 20 * mm, "legal-mind.nl")
    c.setFillColor(ORANJE)
    c.drawString(MARGIN + 28 * mm, 20 * mm, "→")

    # Oranje dots rechtsonder
    for i in range(3):
        c.setFillColor(ORANJE)
        c.circle(PAGE_W - MARGIN - i * 6 * mm, 20 * mm, 1.5 * mm, fill=True, stroke=False)

    c.showPage()


# ═══════════════════════════════════════════════════════════════════════════
# STAPPEN PAGINA'S (afwisselend licht/donker, 3 stappen per pagina)
# ═══════════════════════════════════════════════════════════════════════════

def draw_stappen_pages(c, data, start_page):
    """Tekent alle stappen, 3 per pagina, afwisselend licht/donker."""
    stappen = data.get("stappen", [])
    if not stappen:
        return start_page

    page_num = start_page
    chunks = [stappen[i:i + STAPPEN_PER_PAGINA] for i in range(0, len(stappen), STAPPEN_PER_PAGINA)]

    for chunk_idx, chunk in enumerate(chunks):
        is_dark = (page_num % 2 != 0)  # Pagina 1=donker, 2=licht, 3=donker, 4=licht, etc.
        is_first_step_page = (chunk_idx == 0)
        title = "Stap-voor-stap workflow" if is_first_step_page else "Stap-voor-stap workflow (vervolg)"

        if is_dark:
            _draw_dark_page(c, title, page_num, chunk)
        else:
            _draw_light_step_page(c, title, page_num, chunk)

        page_num += 1

    return page_num


def _draw_light_step_page(c, title, page_num, stappen):
    """Lichte stappenpagina."""
    _draw_light_bg(c)
    _draw_light_header(c, title)

    y = PAGE_H - 62 * mm
    for stap in stappen:
        y = _draw_step_card_light(c, y, stap)
        y -= 5 * mm

    _draw_light_footer(c, page_num)
    c.showPage()


def _draw_dark_page(c, title, page_num, stappen):
    """Donkere stappenpagina."""
    _draw_dark_bg(c)
    _draw_dark_header(c, title)

    y = PAGE_H - 62 * mm
    for stap in stappen:
        y = _draw_step_card_dark(c, y, stap)
        y -= 5 * mm

    _draw_dark_footer(c, page_num)
    c.showPage()


def _draw_step_card_light(c, y, stap):
    """Eén stap-card op lichte achtergrond."""
    nummer = stap.get("nummer", 0)
    titel = stap.get("titel", "")
    fields = _get_step_fields(stap)

    card_h = _calc_card_height(c, fields)

    # Card achtergrond
    c.setFillColor(CARD_LICHT)
    c.roundRect(MARGIN, y - card_h + 4 * mm, CONTENT_W, card_h, 3 * mm, fill=True, stroke=False)

    # Oranje nummercirkel
    _draw_nummer_cirkel(c, MARGIN + 10 * mm, y + 0.5 * mm, nummer)

    # Stap titel
    c.setFillColor(TEKST_DONKER)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(MARGIN + 20 * mm, y, titel)

    # Velden
    _draw_step_fields(c, y - 9 * mm, fields, TEKST_GRIJS, TEKST_DONKER)

    return y - card_h


def _draw_step_card_dark(c, y, stap):
    """Eén stap-card op donkere achtergrond."""
    nummer = stap.get("nummer", 0)
    titel = stap.get("titel", "")
    fields = _get_step_fields(stap)

    card_h = _calc_card_height(c, fields)

    # Card achtergrond (iets lichter dan de pagina)
    c.setFillColor(CARD_DONKER)
    c.roundRect(MARGIN, y - card_h + 4 * mm, CONTENT_W, card_h, 3 * mm, fill=True, stroke=False)

    # Oranje nummercirkel
    _draw_nummer_cirkel(c, MARGIN + 10 * mm, y + 0.5 * mm, nummer)

    # Stap titel in wit
    c.setFillColor(WIT)
    c.setFont("Helvetica-Bold", 12)
    c.drawString(MARGIN + 20 * mm, y, titel)

    # Velden (lichte kleuren op donker)
    _draw_step_fields(c, y - 9 * mm, fields, TEKST_LICHT_GRIJS, LICHT_TEKST)

    return y - card_h


def _get_step_fields(stap):
    """Haal de velden op uit een stap."""
    fields = []
    if stap.get("actie"):
        fields.append(("Wat er gebeurt", stap["actie"]))
    if stap.get("jouw_input"):
        fields.append(("Wat jij doet", stap["jouw_input"]))
    if stap.get("resultaat"):
        fields.append(("Resultaat", stap["resultaat"]))
    return fields


def _calc_card_height(c, fields):
    """Bereken card-hoogte op basis van velden."""
    h = 14 * mm  # Titel + padding
    for label, text in fields:
        lines = _wrap_text(c, text, "Helvetica", 9.5, CONTENT_W - 28 * mm)
        h += len(lines) * 3.8 * mm + 7 * mm
    return h


def _draw_nummer_cirkel(c, x, y, nummer):
    """Teken een oranje cirkel met wit nummer."""
    c.setFillColor(ORANJE)
    c.circle(x, y, 4.5 * mm, fill=True, stroke=False)
    c.setFillColor(WIT)
    c.setFont("Helvetica-Bold", 11)
    num_str = str(nummer)
    num_w = c.stringWidth(num_str, "Helvetica-Bold", 11)
    c.drawString(x - num_w / 2, y - 1.3 * mm, num_str)


def _draw_step_fields(c, y, fields, label_color, text_color):
    """Teken de velden (label + tekst) van een stap."""
    for label, text in fields:
        c.setFillColor(label_color)
        c.setFont("Helvetica-Bold", 8)
        c.drawString(MARGIN + 10 * mm, y, label.upper())
        y -= 4 * mm

        c.setFillColor(text_color)
        c.setFont("Helvetica", 9.5)
        lines = _wrap_text(c, text, "Helvetica", 9.5, CONTENT_W - 28 * mm)
        for line in lines:
            c.drawString(MARGIN + 10 * mm, y, line)
            y -= 3.8 * mm
        y -= 2.5 * mm
    return y


# ═══════════════════════════════════════════════════════════════════════════
# TIPS PAGINA (volgt het afwisselingspatroon)
# ═══════════════════════════════════════════════════════════════════════════

def draw_tips_page(c, data, page_num):
    """Teken de tips-pagina, afgestemd op het licht/donker patroon."""
    tips = data.get("tips", [])
    if not tips:
        return

    is_dark = (page_num % 2 == 0)

    if is_dark:
        _draw_dark_bg(c)
        _draw_dark_header(c, "Tips")
        y = PAGE_H - 62 * mm

        for tip in tips:
            if y < 45 * mm:
                break
            lines = _wrap_text(c, tip, "Helvetica", 9.5, CONTENT_W - 20 * mm)
            card_h = len(lines) * 3.8 * mm + 8 * mm

            c.setFillColor(CARD_DONKER)
            c.roundRect(MARGIN, y - card_h + 4 * mm, CONTENT_W, card_h, 3 * mm, fill=True, stroke=False)
            c.setFillColor(ORANJE)
            c.rect(MARGIN, y - card_h + 4 * mm, 3 * mm, card_h, fill=True, stroke=False)

            c.setFillColor(WIT)
            c.setFont("Helvetica", 9.5)
            text_y = y - 1 * mm
            for line in lines:
                c.drawString(MARGIN + 10 * mm, text_y, line)
                text_y -= 3.8 * mm
            y -= card_h + 4 * mm

        _draw_dark_footer(c, page_num)
    else:
        _draw_light_bg(c)
        _draw_light_header(c, "Tips")
        y = PAGE_H - 62 * mm

        for tip in tips:
            if y < 45 * mm:
                break
            lines = _wrap_text(c, tip, "Helvetica", 9.5, CONTENT_W - 20 * mm)
            card_h = len(lines) * 3.8 * mm + 8 * mm

            c.setFillColor(CARD_WARM)
            c.roundRect(MARGIN, y - card_h + 4 * mm, CONTENT_W, card_h, 3 * mm, fill=True, stroke=False)
            c.setFillColor(ORANJE)
            c.rect(MARGIN, y - card_h + 4 * mm, 3 * mm, card_h, fill=True, stroke=False)

            c.setFillColor(TEKST_DONKER)
            c.setFont("Helvetica", 9.5)
            text_y = y - 1 * mm
            for line in lines:
                c.drawString(MARGIN + 10 * mm, text_y, line)
                text_y -= 3.8 * mm
            y -= card_h + 4 * mm

        _draw_light_footer(c, page_num)

    c.showPage()


# ═══════════════════════════════════════════════════════════════════════════
# GEDEELDE HULPFUNCTIES
# ═══════════════════════════════════════════════════════════════════════════

def _draw_light_bg(c):
    c.setFillColor(LICHT_BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=True, stroke=False)

def _draw_dark_bg(c):
    c.setFillColor(DONKER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=True, stroke=False)

def _draw_light_header(c, title):
    c.setFillColor(TEKST_DONKER)
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 18 * mm, "Legal Mind")
    c.setFont("Helvetica-Bold", 20)
    c.drawString(MARGIN, PAGE_H - 40 * mm, title)
    c.setStrokeColor(ORANJE)
    c.setLineWidth(2)
    c.line(MARGIN, PAGE_H - 45 * mm, PAGE_W - MARGIN, PAGE_H - 45 * mm)

def _draw_dark_header(c, title):
    c.setFillColor(WIT)
    c.setFont("Helvetica-Bold", 10)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 18 * mm, "Legal Mind")
    c.setFont("Helvetica-Bold", 20)
    c.drawString(MARGIN, PAGE_H - 40 * mm, title)
    c.setStrokeColor(ORANJE)
    c.setLineWidth(2)
    c.line(MARGIN, PAGE_H - 45 * mm, PAGE_W - MARGIN, PAGE_H - 45 * mm)

def _draw_light_footer(c, page_num):
    c.setFillColor(FOOTER_GRIJS)
    c.setFont("Helvetica", 8)
    c.drawString(MARGIN, 12 * mm, "Legal Mind B.V.  |  KVK 93846523")
    c.drawRightString(PAGE_W - MARGIN, 12 * mm, f"Pagina {page_num}")

def _draw_dark_footer(c, page_num):
    c.setFillColor(TEKST_LICHT_GRIJS)
    c.setFont("Helvetica", 8)
    c.drawString(MARGIN, 12 * mm, "Legal Mind B.V.  |  KVK 93846523")
    c.drawRightString(PAGE_W - MARGIN, 12 * mm, f"Pagina {page_num}")


def _wrap_text(c, text, font, size, max_width):
    """Wrap tekst naar meerdere regels."""
    words = text.split()
    lines = []
    current_line = ""
    for word in words:
        test_line = f"{current_line} {word}".strip()
        if c.stringWidth(test_line, font, size) <= max_width:
            current_line = test_line
        else:
            if current_line:
                lines.append(current_line)
            current_line = word
    if current_line:
        lines.append(current_line)
    return lines if lines else [""]


# ═══════════════════════════════════════════════════════════════════════════
# MAIN: PDF GENEREREN
# ═══════════════════════════════════════════════════════════════════════════

def generate_pdf(data, output_path):
    """Genereer de volledige werkwijze-PDF."""
    os.makedirs(os.path.dirname(output_path) if os.path.dirname(output_path) else ".", exist_ok=True)

    c = canvas.Canvas(output_path, pagesize=A4)
    c.setTitle(f"Werkwijze — {data.get('skill_name', 'Skill')}")
    c.setAuthor("Legal Mind B.V.")
    c.setSubject("Interne werkwijze")

    # Pagina 1 (donker): Cover + overzicht
    draw_cover_with_overview(c, data)

    # Pagina 2+ : Stappen (afwisselend licht/donker, 3 per pagina)
    next_page = draw_stappen_pages(c, data, 2)

    # Tips (volgt het afwisselingspatroon)
    draw_tips_page(c, data, next_page)

    c.save()
    print(f"Werkwijze PDF gegenereerd: {output_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Genereer werkwijze PDF in Legal Mind huisstijl")
    parser.add_argument("--input", required=True, help="Pad naar JSON met werkwijze-content")
    parser.add_argument("--output", required=True, help="Pad voor output PDF")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        data = json.load(f)

    generate_pdf(data, args.output)
