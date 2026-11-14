# Trademark and branding policy

This document explains what you may do with the OpenQuant name, and records the
third-party marks that appear in the project. It is a statement of the
maintainers' expectations, not legal advice.

## Status of the OpenQuant name

The maintainers of this project hold **no registered trademark** in "OpenQuant."
No application has been filed and no exclusivity is claimed. It is used as an
unregistered project name for a non-commercial, community open-source project.

**Third parties do hold OPENQUANT trademark registrations.** A search of USPTO
records found at least these marks, which are unrelated to this project:

| Serial | Owner | Goods / services | Notes |
| --- | --- | --- | --- |
| 78930882 (Reg. 3244739) | BT Systems, LLC (original registrant: Complex Systems, Inc.) | Online non-downloadable software automating the financial supply chain and end-to-end trade processes | **Live — Registered and Renewed.** Closest field of use. |
| 88886786 | Kevin Azzouz | Online auction technology for locating buyers of physical goods | Reported as abandoned |
| 88843009 | — | — | Reported as abandoned |

Serial 78930882 was checked on 15 August 2026. The record reports **Registered
and Renewed**, registration date 22 May 2007, first renewal accepted 20 August
2016, and a 2018 assignment from Complex Systems, Inc. to BT Systems, LLC. See
the [USPTO TSDR record](https://tsdr.uspto.gov/#caseNumber=78930882&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch).
Trademark status can change, so anyone making a commercial naming decision
should obtain a current clearance search and legal advice.

What this means in practice:

- For this project as it stands — a free, non-commercial, educational
  open-source tool — the risk is low. Trademark rights are tied to use in
  commerce within a field of goods and services, and this project sells nothing.
- The maintainers give **no warranty** that the name is free for you to use, in
  any jurisdiction or product category.
- If you plan to build a **commercial** product, hosted service, or app-store
  listing on this code, do not adopt the "OpenQuant" name without your own
  trademark clearance search and legal advice. The Complex Systems registration
  covers financial trade software, which is adjacent to this project's field.

This is a record of what the maintainers found, not legal advice.

## What the license does and does not grant

OpenQuant is licensed under the Apache License 2.0. Section 6 of that license is
explicit:

> This License does not grant permission to use the trade names, trademarks,
> service marks, or product names of the Licensor, except as required for
> reasonable and customary use in describing the origin of the Work.

So the copyright license lets you use, modify, and redistribute the **code**. It
does not by itself transfer rights in the **name**.

## Using the name

You may, without asking:

- state that your project uses, is built on, is compatible with, or is forked
  from OpenQuant;
- keep the name in unmodified redistributions, including Docker images;
- use the name in articles, talks, tutorials, comparisons, and academic work; and
- use the name in a fork's repository description to describe its origin.

Please do not:

- name a modified or forked distribution "OpenQuant" in a way that suggests it is
  the official project, or that the maintainers produced, reviewed, or endorsed
  it — say "a fork of OpenQuant" rather than "OpenQuant";
- use the name to imply endorsement, affiliation, certification, or partnership
  that does not exist;
- use the name for a hosted service, paid product, or app-store listing in a way
  that a reasonable user would mistake for the official project; or
- register "OpenQuant" or a confusingly similar mark as a trademark, domain, or
  social account intended to impersonate this project.

If you are unsure whether a use is acceptable, open a discussion on the
repository and ask. The maintainers would rather answer a question than resolve a
dispute.

## Logo

**OpenQuant has no logo.** The project ships no logo, wordmark, icon set, or
brand imagery of its own; the application currently uses an empty favicon. There
is therefore no project logo to license, misuse, or attribute.

If a logo is added later, it should be contributed under terms compatible with
redistribution — either the Apache-2.0 project license or a CC-BY-4.0 grant — and
this section must be updated to state the designer, the license, and whether the
logo may be modified.

## Third-party marks appearing in this project

The following marks belong to their respective owners. OpenQuant is **not
affiliated with, endorsed by, sponsored by, or certified by** any of them. Each
is referenced only to identify the corresponding software or data source, which
is nominative fair use.

| Mark | Owner | Why it appears |
| --- | --- | --- |
| TradingView™, Lightweight Charts™ | TradingView, Inc. | The charting library, and its required on-chart attribution |
| S&P 500®, S&P® | S&P Dow Jones Indices LLC | Names a data grouping in a small illustrative seed file |
| Yahoo!®, Yahoo Finance® | Yahoo Inc. | Optional market-data provider, accessed via `yfinance` |
| Binance® | Binance Holdings Ltd. | Optional market-data provider |
| Twelve Data® | Twelve Data Inc. | Optional market-data provider, requires a user-supplied key |
| Geist, Geist Mono | The Geist Project Authors (Vercel) | Bundled UI and monospace fonts |
| PostgreSQL®, Docker® | PostgreSQL Community Association / Docker, Inc. | Required infrastructure named in setup documentation |

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the full font license terms.

## Not a brokerage

OpenQuant is educational and research software. The name must not be used in a
way that implies the software is a broker-dealer, an investment adviser, a
trading venue, or a source of investment advice. It does not submit real orders
and holds no custody of funds. See the disclaimer in [README.md](README.md).
