# Agir Pro Finance

## How the numbers are computed

Agir treats development underwriting as deterministic math, not model output. The LLM may classify extracted candidates and write prose, but it does not create financial values.

Core formulas:

- Total development cost before financing = land + hard costs + soft costs + contingency
- Interest reserve = loan amount x interest rate x `(construction months + lease-up months) / 12` x average outstanding factor
- TDC = pre-financing cost + interest reserve
- GPR = sum of units x monthly rent x 12
- EGI = GPR x stabilized occupancy + other income
- NOI = EGI - operating expenses
- Yield on cost = NOI / TDC
- Development spread = yield on cost - exit cap rate
- Exit value = NOI / exit cap rate
- Development profit = exit value - TDC
- LTC = loan / TDC
- DSCR = NOI / annual debt service
- Equity multiple = sale proceeds and interim cash flow / equity
- IRR = solved from the equity cash-flow vector; if there is no sign change, IRR is reported as not computable.

Every persisted output includes `formula_text` so an analyst can audit the result by hand. Inputs carry provenance through `source = extracted | analyst | default`; Quick Start values use clearly labeled defaults until documents or analyst edits replace them.

