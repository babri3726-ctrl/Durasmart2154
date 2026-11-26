"""
Comprehensive Ledger & Party Classification and City/District Gazetteer.
Distinguishes between real Sundry Debtors (Customers/Dealers) and General Ledger Accounts
(Expenses, Cash, Bank, Loans, Fixed Assets, Investments, Capital/HUF, Taxes).
"""
import re
from typing import Tuple, Optional

# Non-debtor keywords and patterns
PNL_PATTERNS = [
    r"\bprofit\s*(?:&|and)?\s*loss\b",
    r"\bp\s*&\s*l\b",
    r"\bpnl\b",
]

EXPENSE_PATTERNS = [
    r"\bexp(?:enses?|s)?\b",
    r"\bselery\b|\bsalary\b",
    r"\binterst\b|\binterest\b",
    r"\bfreight\b|\bfrt\b|\bcartage\b",
    r"\bloading\b|\bunloading\b",
    r"\brepair\b|\brepairs\b|\bmaint(?:enance)?\b",
    r"\bbrokerage\b|\bcommission\b",
    r"\binsurence\b|\binsurance\b",
    r"\bdiwali\b|\bpooja\b|\bfestival\b",
    r"\baudit\b|\bauditor\b|\blegal\b|\bc\s*a\b",
    r"\bcharity\b|\bdonation\b|\btrust\b|\bfoundation\b|\bdharmarth\b",
    r"\bdepreciation\b|\bdiscount\b|\bround\s*off\b",
    r"\bbank\s*(?:chg|charges|penal)\b",
]

CASH_PATTERNS = [
    r"^cash(?:\s+in\s+hand)?$",
    r"^cash\s+[a-z]+$",
    r"^[a-z]+\s+cash$",
    r"^petty\s+cash$",
    r"khan\s*cash",
    r"cash\s*gbd",
]

BANK_LOAN_PATTERNS = [
    r"\b(?:hdfc|sbi|icici|axis|pnb|yes\s*bank|canara|bob|kotak|rbl|indusind)\s*(?:bank|dura|loan|p\.o|account)?\b",
    r"\bfd\s+in\b|\bfixed\s+deposit\b",
    r"\bvehicle\s+loan\b|\bcar\s+loan\b|\bterm\s+loan\b|\bhousing\s+loan\b|\bloan\s+acc\b",
]

ASSET_INVESTMENT_PATTERNS = [
    r"\bmechnery\b|\bmachinery\b(?!.*\b(?:store|trader|sales|corp|enterprises)\b)",
    r"\bplant\s*(?:&|and)\s*machinery\b",
    r"\bmutul\s*fund\b|\bmutual\s*fund\b|\bshares?\s*market\b|\binvestment\b",
    r"\b(?:land|plot|kothi|flat|farm\s*house|complex|comlex|factory|fac|fec|show\s*room|new\s*car|inova|innova)\b",
    r"^house\s*\d+",
    r"^shop\s*(?:public|\d+)",
]

CAPITAL_PERSONAL_PATTERNS = [
    r"\bhuf\b",
    r"\bcapital\s*acc\b|\bcapital\s*account\b|\bcapital\b",
    r"\bdrawings?\b",
    r"^dharam\s*pal\s+[a-z]+\s*\(cash\)$",
    r"\bjindal\s*(?:acc|cash|i|personal|\d+)\b",
    r"\bdes\s*raj\b",
    r"\bpardeep\s*naman\b",
    r"\bvijay\s*goel\b",
]

TAX_PATTERNS = [
    r"\badvance\s*income\s*tax\b",
    r"^gst\b|^\bgst\s*payable\b|^\bigst\b|^\bcgst\b|^\bsgst\b|\bbill\s*gst\b|\bgst\b",
    r"\btds\b|\btcs\b|\btax\b",
]

PURCHASE_SUPPLIER_PATTERNS = [
    r"^purchage\b|^purchase\b",
    r"^opening\s+stock\b|^closing\s+stock\b",
    r"^import\s+bill\b",
]

# Known Sundry Creditors (Suppliers, Mills, Vendors, Transporters) from Tally Sundry Creditor Ledger
KNOWN_SUNDRY_CREDITORS = {
    "APRAMAPAR JULL",
    "AYS SHIPPING",
    "BALA JI TRADING CO. ( DAGSHAI CUPBOARD)",
    "HUMBLE STEEL PRIVATE LIMITED , PADDI LUDHIANA",
    "JATINDER KUMAR & CO.",
    "JHS ISPAT",
    "JINDAL EXPORT",
    "JSW STEEL COATED PRODUCT (40049316)",
    "KAHNA STAINLESS STEEL",
    "KAMDHENU LTD",
    "K.L.STEEL",
    "KRISHNA SHEET PROCESSER (LUDHIANA)",
    "MANAKSIYA COATED METALS & INDUSTRIES LTD",
    "MOHIT STEEL IND. GBD",
    "NAMAN GOYAL",
    "N H STEEL",
    "PROMPT ENTERPRISES PRIVATE LIMITED BALLABGARH",
    "PUNJAB FORGEING",
    "RADIANT FLAT PRODUCTS PRIVATE LIMITED(MANDI RADINET",
    "RK GOYAL & COMPANY",
    "SACHIN KABJA KHANNA",
    "SANJU KUMAR LOCKTIE MANDI GOBINDGARH",
    "SAT PAL METEL PVT",
    "SHIVA TRADERS LALIT JI BUCHO",
    "SHREE BHAGWATI TRADERS",
    "SHREE KRISHNA STEEL ROLLING MILL",
    "SHREE SAI STEEL FARIDABAD",
    "SONY FEBRICATER GBD",
    "TRAI SERVICES",
    "UNIVERSAL ADVOTISING",
    "UNIVERSAL PROPACK",
    "VIJAY KUMAR CHARAN DASS GBD",
}

RE_PNL = re.compile("|".join(PNL_PATTERNS), re.IGNORECASE)
RE_EXPENSE = re.compile("|".join(EXPENSE_PATTERNS), re.IGNORECASE)
RE_CASH = re.compile("|".join(CASH_PATTERNS), re.IGNORECASE)
RE_BANK_LOAN = re.compile("|".join(BANK_LOAN_PATTERNS), re.IGNORECASE)
RE_ASSET = re.compile("|".join(ASSET_INVESTMENT_PATTERNS), re.IGNORECASE)
RE_CAPITAL = re.compile("|".join(CAPITAL_PERSONAL_PATTERNS), re.IGNORECASE)
RE_TAX = re.compile("|".join(TAX_PATTERNS), re.IGNORECASE)
RE_PURCHASE = re.compile("|".join(PURCHASE_SUPPLIER_PATTERNS), re.IGNORECASE)

# Keywords indicating a commercial trading dealer / customer
DEALER_KEYWORDS = re.compile(
    r"\b(steel|traders?|store|industries|industry|enterprises|pvt|ltd|corp|corporation|trading|agency|agencies|co|company|agro|chokat|chugaath|builder|iron|metal|metel|concast|fabricator|hardware|sales|associates|wire|sheet|tubes?|pipes?|rolling|infra|infrastructure)\b",
    re.IGNORECASE
)

def classify_party_name(name: str) -> str:
    """
    Classifies a ledger / party name into:
    - 'customer': Real Sundry Debtor / Dealer
    - 'expense': Direct or Indirect Expense
    - 'cash': Cash in hand or cash counter account
    - 'bank': Bank accounts, FDs, Loans
    - 'asset': Fixed assets, machinery, investments, property
    - 'capital': Owner capital, HUF, drawings
    - 'tax': GST, TDS, TCS, Advance Tax
    - 'roundoff': Round off ledger
    - 'discount': Discount ledger
    - 'supplier': Sundry Creditors / Purchase accounts
    """
    raw = (name or "").strip()
    norm = " ".join(raw.split())
    norm_lower = norm.lower()
    norm_upper = norm.upper()

    if not norm or norm_lower in ("total", "grand total", "(as per details)"):
        return "expense"

    if norm_upper in ("V.S UDYOG", "BALAJI STEEL AVINASH"):
        return "asset"
    if norm_upper in ("VIPIN GOYAL TRADING", "GONIANA RAKESH JI"):
        return "loan"
    if norm_upper == "SALES DURA":
        return "sales"
    if norm_upper == "NEW CAR INOVA PB10 GY 8228":
        return "asset"

    # Known Sundry Creditors (Suppliers, Mills, Vendors, Transporters) check
    if norm_upper in KNOWN_SUNDRY_CREDITORS:
        return "supplier"
    for cred_kw in ("JHS ISPAT", "PROMPT ENTERPRISES", "SHREE SAI STEEL", "MANAKSIYA COATED", "AYS SHIPPING", "KAMDHENU LTD"):
        if cred_kw in norm_upper:
            return "supplier"

    if RE_PNL.search(norm_lower):
        return "pnl"

    if "round" in norm_lower and "off" in norm_lower:
        return "roundoff"
    if norm_lower == "discount":
        return "discount"

    # Pure cash check first
    if RE_CASH.search(norm_lower):
        return "cash"

    # If it strongly matches expense patterns and is NOT a known dealer entity
    if RE_EXPENSE.search(norm_lower):
        # Some dealers have names like 'Loading Exp Gbd' which is an expense, or 'Harpreet Chokat House Dasua' which is a dealer
        if "house" in norm_lower and any(w in norm_lower for w in ("chokat", "steel", "traders", "iron", "timber")):
            return "customer"
        return "expense"

    if RE_BANK_LOAN.search(norm_lower):
        return "bank"

    if RE_ASSET.search(norm_lower):
        if DEALER_KEYWORDS.search(norm_lower) and not any(w in norm_lower for w in ("mechnery", "machinery", "mutul fund", "mutual fund", "house 303")):
            return "customer"
        return "asset"

    if RE_CAPITAL.search(norm_lower):
        if not DEALER_KEYWORDS.search(norm_lower):
            return "capital"

    if RE_TAX.search(norm_lower):
        if not DEALER_KEYWORDS.search(norm_lower):
            return "tax"

    if RE_PURCHASE.search(norm_lower):
        return "supplier"

    return "customer"

def is_sundry_debtor(name: str, party_type: Optional[str] = None) -> bool:
    """Returns True if the party is a legitimate sundry debtor customer."""
    if party_type and party_type != "customer":
        return False
    return classify_party_name(name) == "customer"

def is_sundry_creditor(name: str, party_type: Optional[str] = None) -> bool:
    """Returns True if the party is a sundry creditor supplier/vendor."""
    if party_type and party_type in ("supplier", "creditor"):
        return True
    return classify_party_name(name) == "supplier"


# Comprehensive Gazette for Punjab, Haryana, UP, HP, Rajasthan, Delhi-NCR
TOWNS_MAP = [
    # Haryana
    (r"\b(BALLABGARH|BALLABHGARH)\b", "Ballabgarh", "Faridabad", "Haryana"),
    (r"\b(FARIDABAD)\b", "Faridabad", "Faridabad", "Haryana"),
    (r"\b(GURGAON|GURUGRAM)\b", "Gurugram", "Gurugram", "Haryana"),
    (r"\b(SIRSA)\b", "Sirsa", "Sirsa", "Haryana"),
    (r"\b(HISAR|HISSAR)\b", "Hisar", "Hisar", "Haryana"),
    (r"\b(AMBALA|AMBALA\s*CANTT|AMBALA\s*CITY)\b", "Ambala", "Ambala", "Haryana"),
    (r"\b(PANIPAT)\b", "Panipat", "Panipat", "Haryana"),
    (r"\b(KARNAL)\b", "Karnal", "Karnal", "Haryana"),
    (r"\b(KURUKSHETRA)\b", "Kurukshetra", "Kurukshetra", "Haryana"),
    (r"\b(YAMUNANAGAR|JAGADHRI)\b", "Yamunanagar", "Yamunanagar", "Haryana"),
    (r"\b(ROHTAK)\b", "Rohtak", "Rohtak", "Haryana"),
    (r"\b(JHAJJAR|BAHADURGARH)\b", "Bahadurgarh", "Jhajjar", "Haryana"),
    (r"\b(SONIPAT|SONEPAT|KUNDLI)\b", "Sonipat", "Sonipat", "Haryana"),
    (r"\b(NARNAUL|MAHENDRAGARH)\b", "Narnaul", "Mahendragarh", "Haryana"),
    (r"\b(REWARI|DHARUHERA)\b", "Rewari", "Rewari", "Haryana"),
    (r"\b(PALWAL)\b", "Palwal", "Palwal", "Haryana"),
    (r"\b(HANSI)\b", "Hansi", "Hisar", "Haryana"),
    (r"\b(PEHOWA)\b", "Pehowa", "Kurukshetra", "Haryana"),
    (r"\b(CHEEKA)\b", "Cheeka", "Kaithal", "Haryana"),
    (r"\b(KAITHAL)\b", "Kaithal", "Kaithal", "Haryana"),
    (r"\b(DABWALI|MANDI\s*DABWALI)\b", "Mandi Dabwali", "Sirsa", "Haryana"),
    (r"\b(KALANWALI|KALIA\s*WALI)\b", "Kalanwali", "Sirsa", "Haryana"),
    (r"\b(FATEHABAD|TOHANA|RATIA)\b", "Fatehabad", "Fatehabad", "Haryana"),
    (r"\b(JIND|NARWANA)\b", "Jind", "Jind", "Haryana"),
    (r"\b(BHIWANI|CHARKHI\s*DADRI)\b", "Bhiwani", "Bhiwani", "Haryana"),
    (r"\b(AGROHA|AGROHA\s*MOR)\b", "Agroha", "Hisar", "Haryana"),
    (r"\b(GOHANA)\b", "Gohana", "Sonipat", "Haryana"),

    # Punjab
    (r"\b(LUDHIANA|BHAMIAN|FOCAL\s*POINT|MILLER\s*GANJ|DEHLON)\b", "Ludhiana", "Ludhiana", "Punjab"),
    (r"\b(JAGRAON|JAGROUN)\b", "Jagraon", "Ludhiana", "Punjab"),
    (r"\b(KHANNA)\b", "Khanna", "Ludhiana", "Punjab"),
    (r"\b(MACHHIWARA|SAMRALA)\b", "Machhiwara", "Ludhiana", "Punjab"),
    (r"\b(MANDI\s*GOBINDGARH|GOBINDGARH)\b", "Mandi Gobindgarh", "Fatehgarh Sahib", "Punjab"),
    (r"\b(AMRITSAR|MAJITHA|RAYYA)\b", "Amritsar", "Amritsar", "Punjab"),
    (r"\b(JALANDHAR|JULLUNDUR|JULL|NAKODAR|PHAGWARA|GORAYA|PHILLAUR)\b", "Jalandhar", "Jalandhar", "Punjab"),
    (r"\b(PATIALA|NABHA|SAMANA|PATRAN)\b", "Patiala", "Patiala", "Punjab"),
    (r"\b(RAJPURA)\b", "Rajpura", "Patiala", "Punjab"),
    (r"\b(BATHINDA|BTI|RAMA\s*MANDI|MAUR\s*MANDI|GONIANA)\b", "Bathinda", "Bathinda", "Punjab"),
    (r"\b(HOSHIARPUR|DASUYA|DASUA|MUKERIAN)\b", "Hoshiarpur", "Hoshiarpur", "Punjab"),
    (r"\b(BARNALA|TAPA)\b", "Barnala", "Barnala", "Punjab"),
    (r"\b(FEROZPUR|FIROZPUR|FIROZPUR\s*CASH|ZIRA|GURU\s*HAR\s*SAHAI)\b", "Ferozepur", "Ferozepur", "Punjab"),
    (r"\b(FARIDKOT|KOTKAPURA|JAITU)\b", "Faridkot", "Faridkot", "Punjab"),
    (r"\b(KAPURTHALA|SULTANPUR\s*LODHI)\b", "Kapurthala", "Kapurthala", "Punjab"),
    (r"\b(SANGRUR|SUNAM|MALERKOTLA|DHURI|LEHRAGAGA)\b", "Sangrur", "Sangrur", "Punjab"),
    (r"\b(MANSA|BUDHLADA|BARETA)\b", "Mansa", "Mansa", "Punjab"),
    (r"\b(BATALA)\b", "Batala", "Gurdaspur", "Punjab"),
    (r"\b(GURDASPUR|DINANAGAR)\b", "Gurdaspur", "Gurdaspur", "Punjab"),
    (r"\b(PATHANKOT|SUJANPUR)\b", "Pathankot", "Pathankot", "Punjab"),
    (r"\b(MOGA|BAGHA\s*PURANA|DHARAMKOT)\b", "Moga", "Moga", "Punjab"),
    (r"\b(MALOUT|SRI\s*MUKTSAR\s*SAHIB|MUKTSAR|GIDDERBAHA)\b", "Malout", "Sri Muktsar Sahib", "Punjab"),
    (r"\b(FAZILKA|ABOHAR|JALALABAD)\b", "Fazilka", "Fazilka", "Punjab"),
    (r"\b(TARN\s*TARAN|TARB\s*TARAN|BHIKHIWIND|PATTI)\b", "Tarn Taran", "Tarn Taran", "Punjab"),
    (r"\b(ROPAR|RUPNAGAR|MORINDA)\b", "Rupnagar", "Rupnagar", "Punjab"),
    (r"\b(MOHALI|SAS\s*NAGAR|DERABASSI|DERA\s*BASSI|KHARAR|ZIRAKPUR)\b", "Mohali", "SAS Nagar", "Punjab"),
    (r"\b(NAWANSHAHR|SBS\s*NAGAR|BANGA)\b", "Nawanshahr", "Shahid Bhagat Singh Nagar", "Punjab"),

    # Uttar Pradesh / NCR
    (r"\b(GHAZIABAD|GBD|SAHIBABAD|MODINAGAR)\b", "Ghaziabad", "Ghaziabad", "Uttar Pradesh"),
    (r"\b(NOIDA|GREATER\s*NOIDA)\b", "Noida", "Gautam Buddha Nagar", "Uttar Pradesh"),
    (r"\b(MEERUT)\b", "Meerut", "Meerut", "Uttar Pradesh"),
    (r"\b(HAPUR)\b", "Hapur", "Hapur", "Uttar Pradesh"),
    (r"\b(ALIGARH)\b", "Aligarh", "Aligarh", "Uttar Pradesh"),
    (r"\b(MATHURA)\b", "Mathura", "Mathura", "Uttar Pradesh"),
    (r"\b(AGRA)\b", "Agra", "Agra", "Uttar Pradesh"),

    # Himachal Pradesh
    (r"\b(KANGRA|DHARAMSHALA)\b", "Kangra", "Kangra", "Himachal Pradesh"),
    (r"\b(SHIMLA)\b", "Shimla", "Shimla", "Himachal Pradesh"),
    (r"\b(SOLAN|BADDI|NALAGARH|PARWANOO)\b", "Baddi", "Solan", "Himachal Pradesh"),
    (r"\b(MANDI|SUNDERNAGAR)\b", "Mandi", "Mandi", "Himachal Pradesh"),
    (r"\b(KULLU|MANALI)\b", "Kullu", "Kullu", "Himachal Pradesh"),
    (r"\b(UNA)\b", "Una", "Una", "Himachal Pradesh"),
    (r"\b(HAMIRPUR)\b", "Hamirpur", "Hamirpur", "Himachal Pradesh"),

    # Rajasthan
    (r"\b(HANUMANGARH|HANUMANGRH|PILIBANGA|SANGARIA)\b", "Hanumangarh", "Hanumangarh", "Rajasthan"),
    (r"\b(SRI\s*GANGANAGAR|GANGANAGAR|SURATGARH)\b", "Sri Ganganagar", "Sri Ganganagar", "Rajasthan"),
    (r"\b(JAIPUR)\b", "Jaipur", "Jaipur", "Rajasthan"),
    (r"\b(ALWAR|BHIWADI)\b", "Bhiwadi", "Alwar", "Rajasthan"),
    (r"\b(BIKANER)\b", "Bikaner", "Bikaner", "Rajasthan"),

    # Delhi
    (r"\b(DELHI|NEW\s*DELHI)\b", "Delhi", "Delhi", "Delhi"),
    (r"\b(CHANDIGARH)\b", "Chandigarh", "Chandigarh", "Chandigarh"),
]

def resolve_location(name: str, fallback_state: str = "Punjab") -> Tuple[str, str, str]:
    """
    Given a party name or station string, extracts (city, district, state).
    Returns proper values without empty strings whenever a known town is mentioned.
    """
    for pattern, city, district, state in TOWNS_MAP:
        if re.search(pattern, name, re.IGNORECASE):
            return city, district, state

    return "", "", fallback_state
