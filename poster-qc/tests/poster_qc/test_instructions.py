from poster_qc.instructions import parse_instructions

MD = '''
## 1. AmericanSymbols  → `JBG-POS-LAM-AmericanSymbols_TOFIX.jpg`
- Under THE AMERICAN FLAG: change "origlnal" to **"original"** (so it reads "13 original colonies").
- change "Francis Scott Ray" to **"Francis Scott Key"**.
## 5. GettysburgAddress  → `JBG-POS-LAM-GettysburgAddress_TOFIX.jpg`
- "Penusylvania" → **"Pennsylvania"**
- "Contest:" → **"Context:"**
'''

def test_parse_groups_by_sku():
    d = parse_instructions(MD)
    assert d["JBG-POS-LAM-AmericanSymbols"] == [("origlnal", "original"), ("Francis Scott Ray", "Francis Scott Key")]
    assert d["JBG-POS-LAM-GettysburgAddress"] == [("Penusylvania", "Pennsylvania"), ("Contest:", "Context:")]
