# Quality Tools for Manufacturing

Static, dependency-free browser tools for shop-floor quality work. Open `index.html` or run `npm start` and visit http://localhost:8080.

| Tool | What it does |
| --- | --- |
| `spc.html` | I-MR and Xbar-R charts, Nelson rules 1-3, Cp/Cpk/Pp/Ppk, expected PPM |
| `fmea.html` | FMEA worksheet with RPN and Action Priority, CSV export, local autosave |
| `sigma.html` | DPMO, yield and sigma level (1.5 shift by default), both directions |

| `oee.html` | OEE with loss breakdown, takt and line balance, Little's Law, Kingman queue time |
| `kanban.html` | Push vs CONWIP/kanban simulation with WIP sweep charts |
| `vsm.html` | Current-state VSM arithmetic: lead time, value-added ratio, load vs takt |
| `selector.html` | Symptom-based framework recommender (links to the frameworks site) |

All maths lives in `lib/qtools.js` (quality) and `lib/ops.js` (flow) and is covered by `npm test` (Node 18+).

## Method notes
- Cp/Cpk use within-subgroup sigma (MRbar/1.128 or Rbar/d2); Pp/Ppk use the overall sample standard deviation.
- Capability is only meaningful when the chart shows a stable process. The tool says so when signals appear.
- Control limits use standard constants (d2, A2, D3, D4) for subgroup sizes 2 to 10.
- **Action Priority:** the AIAG-VDA table is copyrighted and not included. The default AP column is an illustrative severity-weighted rule. Load your licensed table as CSV (`S,O,D,AP`) in the FMEA page for official values.
- Sigma level follows the conventional 1.5-sigma shift; change it in the sigma tool.

## Deploy
Any static host works (GitHub Pages: Settings, Pages, deploy from branch `main`, root folder).

## Roadmap
Demand-driven buffer sizing (DDMRP), CONWIP/POLCA card loops, 8D and APQP checklists.
