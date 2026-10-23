# Snippets map – data, licences and attribution (v1.2)

All map data is self-hosted in `assets/data/`. No third-party tile servers, CDNs or tracking are used by the map.
Build script: `_authoring/mapwork2/build_map2_data.py` (plus `_authoring/mapwork/fix_states.py` for the India fix-up).

## Datasets

| File(s) | Source | Licence | Processing |
|---|---|---|---|
| `countries.topo.json` | [Natural Earth](https://www.naturalearthdata.com/) 1:10m Admin 0 – Countries, **India point-of-view** edition (`ne_10m_admin_0_countries_ind`) | Public domain ([terms](https://www.naturalearthdata.com/about/terms-of-use/)) | Simplified with mapshaper, Antarctica removed, TopoJSON |
| `admin1/{id}.json` (236 files, lazy-loaded per country) | Natural Earth 1:10m Admin 1 – States, Provinces | Public domain | Simplified; one file per country; UK local authorities and the Admin 1 of SI, LV, MT, UG dissolved into the 4 UK nations / statistical regions / regions; neighbours' (PK, CN, NP) Admin 1 clipped to India's boundary as per Survey of India map |
| `admin1/IN.json`, `india-states.topo.json` | Natural Earth Admin 1 India, with J&K, Ladakh and Arunachal Pradesh corrected to India's external boundary as in the Survey of India political map (2 Nov 2019) | Public domain (NE data); the boundary alignment is Snippets' own editing | `fix_states.py` |
| `admin2/US-{postal}.json` (53 files, lazy-loaded per state) | Natural Earth 1:10m Admin 2 – Counties (US) | Public domain | Simplified, grouped by state |
| `places/{id}.json` (234 files, lazy-loaded per country) and `search.json` | [GeoNames](https://www.geonames.org/) `cities15000` dump (places with population > 15,000) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) – **attribution required** | Selected by population (all state capitals and cities >100k in India, up to ~6 towns per Indian state beyond that; world cities >500k, capped per country/state), near-duplicate suburbs/districts collapsed, assigned to Natural Earth Admin 1; cities inside India's claimed boundary are assigned to India |
| `assets/vendor/d3.v7.9.0.min.js`, `topojson-client.3.1.0.min.js` | d3 (Mike Bostock), topojson-client | ISC (see `assets/vendor/LICENSES.txt`) | None |
| Inter font (if bundled) | Rasmus Andersson | SIL OFL 1.1 | None |

### Attribution wording

> Map data: Natural Earth (public domain). Towns and cities: GeoNames (https://www.geonames.org/), licensed under CC BY 4.0. Data has been simplified, selected and regrouped by Snippets.

Shown in the site footer, in the map credit overlay, in the note under the map and on `about.html`.

## India boundaries and disclaimer

India's external boundaries are drawn to follow the Survey of India political map (incl. all of Jammu & Kashmir, Ladakh and Arunachal Pradesh). The geometry is **simplified and not certified by the Survey of India**. Other borders are simplified and imply no view on any dispute. The disclaimer stays visible under the map.

## India districts – deliberately NOT included

No India district (Admin 2) layer is shipped. The only freely downloadable candidates (e.g. datameet's district boundaries, CC BY 2.5 India) derive from Census/Bhuvan/GeoCommons material with unclear upstream rights and do not follow the Survey of India 2019 boundaries (J&K/Ladakh), so they could not be verified as properly licensed and POV-correct. India therefore drills **state → cities/towns**. Natural Earth Admin 2 is shipped only for US counties. A district layer can be added if an officially open-licensed source (e.g. a Survey of India / Government open-data release under NDSAP/GODL-India) is cleared.

## Known data caveats

- GeoNames is crowd-sourced: populations can be stale or urban-agglomeration values; a few suburbs may remain as separate places.
- Micro-states/territories too small to exist in the simplified countries geometry cannot be clicked on the map (they are reachable via search/list where a place file exists).
