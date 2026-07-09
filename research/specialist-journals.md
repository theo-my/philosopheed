# Specialist Journal Lists — Philosopheed Dashboard

Candidate journal lists for three specialist modes. Compiled 2026-07-09.

**Grounding sources**
- **Leiter Reports specialist poll** (moral/political philosophy, Aug 2022, Condorcet method) — the field-standard reputational ranking for ethics. [Results](https://leiterreports.com/2022/08/04/specialist-journals-that-publish-the-best-articles-in-moral-and-or-political-philosophy-the-results/) · [raw poll](https://civs1.civs.us/cgi-bin/results.pl?id=E_fa46bdaa9641a92c)
- **Philosophers' Cocoon "Best-regarded journals for AI/Tech ethics?"** (Feb 2026) — current field consensus for phil-tech tiering. [Thread](https://philosopherscocoon.com/2026/02/17/best-regarded-journals-for-ai-tech-ethics/)
- **Publisher subject listings** (Springer, Wiley, Cambridge Core, University of Chicago Press, Elsevier, Sage, Brill, BMJ, PDCnet, MIT Press) — for existence, publisher, frequency.
- **ISSN Portal** (portal.issn.org), **Wikipedia**, and **MIAR** — for ISSN verification.
- Note: Leiter has **no** dedicated specialist poll for philosophy of science or philosophy of technology; those two lists rest on publisher subject listings + well-known field consensus + the de Bruin *Synthese* meta-ranking ([2023](https://link.springer.com/article/10.1007/s11229-023-04342-9)).

**RSS feed verification method** — feed URL *patterns* were tested live with `curl` (HTTP 200 + valid XML checked). Confirmed working patterns:
- **Springer**: `https://link.springer.com/search.rss?facet-journal-id=<ID>&query=&facet-content-type=Article` (tested: 13347, 146, 11229 → returned journal-specific articles)
- **Wiley**: `https://onlinelibrary.wiley.com/feed/<online-ISSN-no-dash>/most-recent` (tested: Bioethics 14678519 → 200)
- **Univ. of Chicago Press (Atypon)**: `https://www.journals.uchicago.edu/action/showFeed?type=etoc&feed=rss&jc=<code>` (tested: bjps, et → 200)
- **Elsevier/ScienceDirect**: `https://rss.sciencedirect.com/publication/science/<ISSN-no-dash>` (tested: 00393681 → 200)
- **Sage**: `https://journals.sagepub.com/action/showFeed?ui=0&mi=0&ai=2b4&jc=<code>&type=etoc&feed=rss` (tested: bds, ppe → 200)
- **BMJ**: `https://jme.bmj.com/rss/current.xml` (tested → 200)
- **OJS (JESP)**: `https://www.jesp.org/feed.xml` (tested → 200)
- **Cambridge Core** and **Brill** actively block automated fetch (403/405/503); their feeds exist (Cambridge via an on-page RSS icon → `.../core/rss/product/id/<hex>`) but the URL is not automatically resolvable, so marked "not found". **PDCnet** (Techné) and **MIT Press** direct.mit.edu feeds were not locatable.

Entries marked "verified" were individually HTTP-tested; "pattern" were constructed from a live-tested same-publisher pattern.

---

## Mode 1 — ETHICS (moral & political philosophy)

| Journal | Publisher | ISSN (print / online) | RSS URL | ~Articles/yr | Basis for inclusion |
|---|---|---|---|---|---|
| Ethics | University of Chicago Press | 0014-1704 / 1539-297X | `https://www.journals.uchicago.edu/action/showFeed?type=etoc&feed=rss&jc=et` (verified) | ~30 (4 issues) | Leiter poll **Group 1** (top-ranked) |
| Philosophy & Public Affairs | Wiley | 0048-3915 / 1088-4963 | `https://onlinelibrary.wiley.com/feed/10884963/most-recent` (pattern) | ~15–20 | Leiter poll **Group 2** |
| Journal of Moral Philosophy | Brill | 1740-4681 / 1745-5243 | not found (Brill blocks automated fetch) | ~30 | Leiter poll **Group 3** |
| Utilitas | Cambridge University Press | 0953-8208 / 1741-6183 | not found (Cambridge Core — RSS icon only) | ~25 (quarterly) | Leiter poll **Group 3** |
| Journal of Ethics and Social Philosophy | Univ. of Southern California (Diamond OA) | — / 1559-3061 | `https://www.jesp.org/feed.xml` (verified) | ~15–20 | Leiter poll **Group 3**; open access |
| Economics & Philosophy | Cambridge University Press | 0266-2671 / 1474-0028 | not found (Cambridge Core — RSS icon only) | ~20 (3 issues) | Leiter poll **Group 3** |
| Politics, Philosophy & Economics | Sage | 1470-594X / 1741-3060 | `https://journals.sagepub.com/action/showFeed?ui=0&mi=0&ai=2b4&jc=ppe&type=etoc&feed=rss` (verified) | ~20 (quarterly) | Leiter poll **Group 3** |
| Ethical Theory and Moral Practice | Springer | 1386-2820 / 1572-8447 | `https://link.springer.com/search.rss?facet-journal-id=10677&query=&facet-content-type=Article` (pattern) | ~60 (5 issues) | Leading normative/practical ethics venue (field consensus) |
| The Journal of Ethics | Springer | 1382-4554 / 1572-8609 | `https://link.springer.com/search.rss?facet-journal-id=10892&query=&facet-content-type=Article` (pattern) | ~25 (quarterly) | Established moral-theory venue (field consensus) |
| Journal of Applied Philosophy | Wiley (Soc. for Applied Philosophy) | 0264-3758 / 1468-5930 | `https://onlinelibrary.wiley.com/feed/14685930/most-recent` (pattern) | ~60 (5 issues) | Leading applied-ethics venue |
| Bioethics | Wiley (Intl. Assoc. of Bioethics) | 0269-9702 / 1467-8519 | `https://onlinelibrary.wiley.com/feed/14678519/most-recent` (verified) | ~80 (9/yr) | Flagship bioethics journal (borderline — see notes) |
| Journal of Medical Ethics | BMJ Publishing Group | 0306-6800 / 1473-4257 | `https://jme.bmj.com/rss/current.xml` (verified) | ~241 (monthly) | Flagship medical-ethics journal (borderline — see notes) |

**12 journals.** The first 7 are exactly the Leiter 2022 Group 1–3 specialist journals (excluding the *Oxford Studies* book series, which are edited annuals, not journals). The last 5 broaden into normative theory and applied/bio-medical ethics.

**Borderline / notes:**
- **Journal of Political Philosophy (Wiley, 0963-8016 / 1467-9760)** — a Leiter Group 3 journal, but it **ceased publication effective 1 Jan 2026** after Wiley ousted editor Bob Goodin and the entire board resigned ([Daily Nous](https://dailynous.com/2025/07/28/journal-of-political-philosophy-officially-ends/)). **Do not include as active.** Its successor is **Political Philosophy** (Open Library of Humanities, Diamond OA, ISSN 3033-3830, edited by Goodin et al.) — a strong candidate to add, though brand-new (first article Mar 2024) and RSS not yet verified. [Announcement](https://dailynous.com/2024/01/12/solidarity-among-philosophers-leads-to-new-journal-political-philosophy/)
- **Philosophy & Public Affairs** — note that its editorial board also resigned in 2024 and launched a rival OA journal (*Free & Equal*, OLH); P&PA continues under Wiley but with reduced standing. Both P&PA and its successor are worth tracking.
- **Bioethics** and **Journal of Medical Ethics** are applied/interdisciplinary bio-medical venues, not core moral philosophy — include only if the dashboard wants applied-ethics coverage. JME in particular is high-volume (~240/yr) and clinical.
- Excluded on purpose: **Journal of Value Inquiry**, **Res Publica**, **Social Theory and Practice**, **Philosophy & Social Criticism** — reputable but a tier below the Leiter cohort.

---

## Mode 2 — PHILOSOPHY OF SCIENCE

| Journal | Publisher | ISSN (print / online) | RSS URL | ~Articles/yr | Basis for inclusion |
|---|---|---|---|---|---|
| The British Journal for the Philosophy of Science | University of Chicago Press (Brit. Soc. for Phil. of Sci.) | 0007-0882 / 1464-3537 | `https://www.journals.uchicago.edu/action/showFeed?type=etoc&feed=rss&jc=bjps` (verified) | ~30 (quarterly) | Top general phil-sci journal (field consensus; #5 Phil in CiteScore). Moved OUP→Chicago in 2021 |
| Philosophy of Science | Cambridge University Press (Phil. of Sci. Assoc.) | 0031-8248 / 1539-767X | not found (Cambridge Core — RSS icon only) | ~50 (5 issues) | Official PSA journal; top-tier. Moved Chicago→Cambridge in 2023 |
| Synthese | Springer | 0039-7857 / 1573-0964 | `https://link.springer.com/search.rss?facet-journal-id=11229&query=&facet-content-type=Article` (verified) | ~400–540 | Leading epistemology/phil-sci venue; very high volume |
| Studies in History and Philosophy of Science | Elsevier | 0039-3681 / 1879-2510 | `https://rss.sciencedirect.com/publication/science/00393681` (verified) | ~80–100 | Flagship HPS journal; absorbed Parts B (Modern Physics) & C (Bio/Biomed) in 2021 |
| European Journal for Philosophy of Science | Springer (Eur. Phil. of Sci. Assoc.) | 1879-4912 / 1879-4920 | `https://link.springer.com/search.rss?facet-journal-id=13194&query=&facet-content-type=Article` (pattern) | ~50 (quarterly) | Official EPSA journal; leading European phil-sci venue |
| Erkenntnis | Springer | 0165-0106 / 1572-8420 | `https://link.springer.com/search.rss?facet-journal-id=10670&query=&facet-content-type=Article` (pattern) | ~120 | Major analytic phil-sci/epistemology journal |
| Biology & Philosophy | Springer | 0169-3867 / 1572-8404 | `https://link.springer.com/search.rss?facet-journal-id=10539&query=&facet-content-type=Article` (pattern) | ~40 | Flagship philosophy-of-biology journal |
| Foundations of Physics | Springer | 0015-9018 / 1572-9516 | `https://link.springer.com/search.rss?facet-journal-id=10701&query=&facet-content-type=Article` (pattern) | ~100 (monthly) | Leading foundations-of-physics venue (borderline — see notes) |
| Journal for General Philosophy of Science | Springer | 0925-4560 / 1572-8587 | `https://link.springer.com/search.rss?facet-journal-id=10838&query=&facet-content-type=Article` (pattern) | ~30 | Established general phil-sci journal |
| Perspectives on Science | MIT Press | 1063-6145 / 1530-9274 | not found (direct.mit.edu feed not locatable) | ~25 | HPS/science-studies venue (borderline — see notes) |

**10 journals.** Top 4 (BJPS, Philosophy of Science, Synthese, SHPS) are the uncontested core. EJPS, Erkenntnis, Biology & Philosophy round out the strong general/special-science tier.

**Borderline / notes:**
- **Foundations of Physics** and **Perspectives on Science** straddle physics/HPS rather than pure philosophy of science — include if the dashboard wants special-science + HPS breadth.
- **Synthese** is nominally epistemology + phil-sci and publishes enormous volume (~500/yr); a phil-sci-only dashboard may want to weight/filter it.
- Publisher moves to note for feed maintenance: **BJPS** OUP→Chicago (2021); **Philosophy of Science** Chicago→Cambridge (2023). Old OUP/Chicago feed URLs for these are now dead.
- Excluded: **HOPOS: The Journal of the Intl. Soc. for the History of Phil. of Science** (Chicago; more history-of-science), **International Studies in the Philosophy of Science** (T&F), **Philosophy of the Social Sciences** (Sage) — reputable but narrower/second-tier.

---

## Mode 3 — PHILOSOPHY OF TECHNOLOGY / AI

| Journal | Publisher | ISSN (print / online) | RSS URL | ~Articles/yr | Basis for inclusion |
|---|---|---|---|---|---|
| Philosophy & Technology | Springer | 2210-5433 / 2210-5441 | `https://link.springer.com/search.rss?facet-journal-id=13347&query=&facet-content-type=Article` (verified) | ~60–80 | Top phil-tech/AI journal per Cocoon 2026 consensus; ed. Floridi |
| Minds and Machines | Springer | 0924-6495 / 1572-8641 | `https://link.springer.com/search.rss?facet-journal-id=11023&query=&facet-content-type=Article` (pattern) | ~30–40 | Top phil-tech/AI journal per Cocoon 2026 consensus (AI, philosophy, cog-sci) |
| Ethics and Information Technology | Springer | 1388-1957 / 1572-8439 | `https://link.springer.com/search.rss?facet-journal-id=10676&query=&facet-content-type=Article` (pattern) | ~50 | Established info-tech ethics venue (Cocoon: on par with AI&Society tier) |
| AI & Society | Springer | 0951-5666 / 1435-5655 | `https://link.springer.com/search.rss?facet-journal-id=146&query=&facet-content-type=Article` (verified) | ~250–300 | Well-regarded specialist journal (Cocoon: one tier below top pair); high volume |
| Science and Engineering Ethics | Springer | 1353-3452 / 1471-5546 | `https://link.springer.com/search.rss?facet-journal-id=11948&query=&facet-content-type=Article` (pattern) | ~60–80 | Established research/engineering ethics venue (Cocoon tier) |
| AI and Ethics | Springer | 2730-5953 / 2730-5961 | `https://link.springer.com/search.rss?facet-journal-id=43681&query=&facet-content-type=Article` (pattern) | ~300–400 | Fast-growing AI-ethics venue (Cocoon tier); very high volume (borderline — see notes) |
| Big Data & Society | Sage (Diamond/Gold OA) | — / 2053-9517 | `https://journals.sagepub.com/action/showFeed?ui=0&mi=0&ai=2b4&jc=bds&type=etoc&feed=rss` (verified) | ~60–80 | Leading data/society venue (borderline — interdisciplinary; see notes) |
| Techné: Research in Philosophy and Technology | Philosophy Documentation Center (Soc. for Phil. & Tech.) | — / 1091-8264 (also 2691-5928) | not found (PDCnet — no feed located) | ~20 (3/yr) | Core society journal for classical philosophy of technology |
| Digital Society | Springer | 2731-4650 / 2731-4669 | `https://link.springer.com/search.rss?facet-journal-id=44206&query=&facet-content-type=Article` (pattern) | ~40 | Dedicated phil-of-the-digital journal (borderline — new; see notes) |

**9 journals.** The Cocoon Feb-2026 thread gives a clean tiering: top pair = **Philosophy & Technology** + **Minds and Machines**; next tier = **AI & Society**, **AI and Ethics**, **Science and Engineering Ethics**, **Ethics and Information Technology**. Techné and Digital Society add classical-phil-tech and digital-philosophy coverage.

**Borderline / notes:**
- **Big Data & Society** is an STS/social-science journal (Sage), not core philosophy — but it is the flagship for data/AI-society critique and is frequently cited by philosophers of technology. Include if the dashboard wants the critical/STS wing; exclude if strictly analytic philosophy.
- **AI and Ethics** (2021–) and **AI & Society** are high-volume and less selective than the top pair — good for coverage/recall but noisier signal.
- **Digital Society** (2022–) is very new, not yet indexed/ranked, and low-volume; include speculatively for emerging coverage.
- **Techné** has no discoverable RSS feed (PDCnet platform); it would need scraping or manual TOC checks.
- Also worth considering (not included): **Journal of Responsible Innovation** (T&F), **NanoEthics** (Springer), **Synthese** (as the Cocoon thread notes, it has become a home for more phil-sci-oriented AI work — already in Mode 2), **Philosophy Compass** (survey articles). The **AI ethics** space also has strong non-philosophy CS venues (FAccT proceedings, *AI Magazine*) deliberately excluded as out of philosophical scope.
