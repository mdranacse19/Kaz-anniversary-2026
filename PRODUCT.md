# PRODUCT.md — KAZ Anniversary Tour 2026

## What this is

A static internal website for KAZ Software colleagues to explore five anniversary-tour destination options and record a personal vote. The site tells one continuous story; it is not a booking tool, corporate portal, or live voting backend.

## Users

- Primary: KAZ Software team members opening the site on phone or laptop
- Job: understand the trip idea, explore destinations, pick one preference, see published collective results

## Success

Within seconds a visitor knows: we are planning a trip together, here are the options, here is how to vote, here is the current published vote picture.

## Capabilities

- Browse five destinations with photography and short Bangla copy
- Expand a destination for a little more useful detail
- Select exactly one destination and save the choice in `localStorage`
- Read published vote counts from `data/poll-results.json`
- Organizers update JSON and redeploy to refresh collective counts

## Constraints

- Static site only (no database, API, auth, or third-party poll service)
- Do not fake live shared vote increments in the browser
- Do not invent travel dates, prices, participant counts, weather, or other unverified claims
- Preserve destination IDs: `sundarbans`, `sylhet`, `rangamati`, `sajek_rangamati`, `nepal`
- Keep KAZ brand recognizability; official mark is black / white / gold swoosh ([kaz.com.bd](https://www.kaz.com.bd/)); logo asset lives at `assets/kaz-logo.png`
- Bangla-first copy; conversational coworker tone

## Voice

Warm, short, contemporary Bangla. Playful where natural. No corporate jargon, no generic travel marketing, no AI-sounding poetry.

Campaign spirit (use sparingly): কাজ অনেক হয়েছে—এবার ঘুরে আসি। Optional supporting line: AI কাজ করুক, আমরা ঘুরতে যাই।

## Stack

Plain static HTML / CSS / JS (existing). Deployed as static files (e.g. Vercel).

## Platform

web

## Inferred from brief

All sections above are taken from the redesign brief dated 2026-09-22 and existing repo facts. No separate interview round was possible in this session (no structured question tool).
