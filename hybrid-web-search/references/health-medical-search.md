# Health/Medical Search Strategy

## Key Learnings from Hantavirus Research Session (May 2026)

### Issue: Broad queries return irrelevant results
Initial search for "current hantavirus situation USA 2026" returned:
- European cruise ship outbreaks (ECDC assessments)
- Blog posts from non-authoritative sources (Box-Kat)
- Minimal US-specific case data

### Solution: Multi-stage refinement strategy

1. **Anchor to authoritative domains first**
   - Use `site:cdc.gov` or `site:who.int` in queries
   - Example: `site:cdc.gov hantavirus current situation 2026`
   - This filters out European cruise ship content immediately

2. **Specify disease variant**
   - "Andes virus" returns cruise ship and South American content
   - "Sin Nombre virus" or "HPS" targets US-specific Hantavirus Pulmonary Syndrome
   - Generic "hantavirus" returns mixed international results

3. **Combine geographic and temporal constraints**
   - `site:apnews.com hantavirus Tierra del Fuego Argentina 2025`
   - `site:cdc.gov hantavirus cases statistics USA 2024 2025 2026`

4. **Avoid single-site queries when results are zero**
   - `site:cdc.gov hantavirus current situation 2026` → 20 results (good)
   - `site:cdc.gov site:who.int hantavirus Andes outbreak 2025 2026` → 0 results (too restrictive)
   - Strategy: start broad, narrow progressively

### Authoritative Sources Found
- **CDC**: `https://www.cdc.gov/hantavirus/`
  - Situation summaries: `cdc.gov/hantavirus/situation-summary/`
  - Case data: `cdc.gov/hantavirus/data-research/cases/`
  - Andes virus info: `cdc.gov/hantavirus/about/andesvirus.html`
- **AP News**: `https://apnews.com/hub/hantavirus`
  - Breaking coverage of international outbreaks
- **WHO**: `https://www.who.int/emergencies/disease-outbreak-news/`
  - Global outbreak notifications

### Pitfalls Documented
- Cruise ship outbreaks dominate international hantavirus searches
- European health agencies (ECDC) prioritize cruise-related content
- US-specific case data requires explicit geographic anchoring
- Social media results (Facebook, Good Morning America) appear in general searches
- Medical terminology matters: "HPS" vs "hantavirus pulmonary syndrome" vs "Andes virus"

### Reference URLs
- CDC Hantavirus Page: https://www.cdc.gov/hantavirus/
- CDC Situation Summary: https://www.cdc.gov/hantavirus/situation-summary/index.html
- CDC Andes Virus: https://www.cdc.gov/hantavirus/about/andesvirus.html
- AP News Hantavirus Hub: https://apnews.com/hub/hantavirus
- AP News Tierra del Fuego Outbreak: https://apnews.com/video/experts-to-study-sites-visited-by-hantavirus-infected-couple-in-south-americas-tierra-del-fuego-dd43dbc11b1b4790873ca6b451f7b04a
- ECDC Hantavirus Assessment: https://www.ecdc.europa.eu/en/publications-data/hantavirus-associated-cluster-illness-cruise-ship-ecdc-assessment-and