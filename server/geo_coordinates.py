"""
Geographic coordinate repository and coverage calculator for Punjab, Haryana, and adjoining regions.
100% offline, zero-latency, free OpenStreetMap coordinate mapping.
"""

from typing import Any
import sqlite3
import os

# Regional State Centers
STATE_CENTERS: dict[str, tuple[float, float]] = {
    "HARYANA": (29.0588, 76.0856),
    "PUNJAB": (31.1471, 75.3412),
    "RAJASTHAN": (27.0238, 74.2179),
    "HIMACHAL PRADESH": (31.1048, 77.1734),
    "JAMMU": (32.7266, 74.8570),
    "INDIA": (30.0000, 76.0000),
}

# 51 Northern India Districts (Lat, Lng)
DISTRICT_COORDINATES: dict[str, tuple[float, float]] = {
    # Haryana
    "AMBALA": (30.3782, 76.7767),
    "FATEHABAD": (29.5161, 75.4542),
    "GURUGRAM": (28.4595, 77.0266),
    "HISAR": (29.1492, 75.7217),
    "AGROHA": (29.3242, 75.6148),
    "HANSI": (29.1022, 75.9619),
    "JAKHAL": (29.7894, 75.8306),
    "JHAJJAR": (28.6063, 76.6565),
    "JIND": (29.3150, 76.3154),
    "KAITAHL": (29.8015, 76.3996),
    "KAITHAL": (29.8015, 76.3996),
    "KARNAL": (29.6857, 76.9905),
    "KURUKSHETRA": (29.9695, 76.8783),
    "MAHENDARGARH": (28.0435, 76.1070),
    "MAHENDERGARH": (28.0435, 76.1070),
    "PANIPAT": (29.3909, 76.9635),
    "REWARI": (28.1887, 76.6186),
    "ROHTAK": (28.8955, 76.6066),
    "SIRSA": (29.5349, 75.0289),
    "SONIPAT": (28.9931, 77.0151),
    "YAMUNANAGAR": (30.1290, 77.2674),
    
    # Punjab
    "AMRITSAR": (31.6340, 74.8723),
    "BARNALA": (30.3819, 75.5466),
    "BATHINDA": (30.2110, 74.9455),
    "CHUNNI": (30.6400, 76.5400),
    "FARIDKOT": (30.6769, 74.7583),
    "FAZILKA": (30.4037, 74.0254),
    "FEROZPUR": (30.9237, 74.6133),
    "FIROZPUR": (30.9237, 74.6133),
    "GURDASPUR": (32.0419, 75.4053),
    "HOSHIARPUR": (31.5273, 75.9142),
    "JALANDHAR": (31.3260, 75.5762),
    "KAPURTHALA": (31.3802, 75.3819),
    "LUDHIANA": (30.9010, 75.8573),
    "MALERKOTLA": (30.5256, 75.8895),
    "MANSA": (29.9889, 75.3934),
    "MOGA": (30.8165, 75.1717),
    "MOHALI": (30.7046, 76.7179),
    "MUKTSAR": (30.4762, 74.5122),
    "NAWANSHAHR": (31.1256, 76.1189),
    "NAWASHAR": (31.1256, 76.1189),
    "PATHANKOT": (32.2684, 75.6529),
    "PATIALA": (30.3398, 76.3869),
    "ROPAR": (30.9664, 76.5331),
    "SANGRUR": (30.2458, 75.8421),
    "TARN TARAN": (31.4520, 74.9270),
    
    # Border & Adjoining
    "GANGANAGAR": (29.9094, 73.8799),
    "HANUMANGARH": (29.5810, 74.3294),
    "KILLIANWALI": (29.9575, 74.7246),
    "H.P.": (31.1048, 77.1734),
    "NADON": (31.7800, 76.3400),
    "JAMMU": (32.7266, 74.8570),
}

# 104 Cities & Commercial Hubs (Lat, Lng)
CITY_COORDINATES: dict[str, tuple[float, float]] = {
    # Key Hubs
    "ABOHAR": (30.1453, 74.1994),
    "AJNALA": (31.8415, 74.7615),
    "ALFUKE": (30.9300, 74.6200),
    "AMRITSAR": (31.6340, 74.8723),
    "BAGHAPURANA": (30.6841, 75.0864),
    "BAHADURGARH": (28.6924, 76.9240),
    "BALACHOUR": (31.0664, 76.3150),
    "BANGA": (31.1878, 75.9961),
    "BARNALA": (30.3819, 75.5466),
    "BARWALA": (29.3564, 75.9126),
    "BATALA": (31.8186, 75.2028),
    "BATHINDA": (30.2110, 74.9455),
    "BEHRAMPUR": (32.0900, 75.4500),
    "BHAMIAN": (30.9200, 75.9100),
    "BHAWANIGARH": (30.2372, 76.0375),
    "BHORA KALAN": (28.3200, 76.8500),
    "CHEEKA": (29.9678, 76.2238),
    "CHUNNI": (30.6400, 76.5400),
    "DABWALI": (29.9575, 74.7246),
    "DEHLON": (30.7719, 75.8778),
    "DELHON": (30.7719, 75.8778),
    "DERA BASSI": (30.5844, 76.8443),
    "DEWANGARH": (29.8500, 74.5500),
    "DHANOLA": (30.2797, 75.5786),
    "DHARAMKOT": (30.9453, 75.2344),
    "FARIDKOT": (30.6769, 74.7583),
    "FATEHABAD": (29.5161, 75.4542),
    "FEROZPUR": (30.9237, 74.6133),
    "FIROZPUR": (30.9237, 74.6133),
    "GANGANAGAR": (29.9094, 73.8799),
    "GHANOUR": (30.3300, 76.6200),
    "GOHANA": (29.1364, 76.6975),
    "H.P.": (31.1048, 77.1734),
    "HABOWAL": (30.9200, 75.8200),
    "HANSI": (29.1022, 75.9619),
    "HANUMANGARH": (29.5810, 74.3294),
    "HARIKE": (31.1683, 74.9622),
    "HISAR": (29.1492, 75.7217),
    "HOSHIARPUR": (31.5273, 75.9142),
    "JAGRAON": (30.7850, 75.4789),
    "JALANDHAR": (31.3260, 75.5762),
    "JAMMU": (32.7266, 74.8570),
    "JANDIALA GURU": (31.5647, 75.0272),
    "JODHAN": (30.7892, 75.7336),
    "KAITHAL": (29.8015, 76.3996),
    "KARNAL": (29.6857, 76.9905),
    "KOT ISE KHA": (30.9000, 75.1200),
    "KOTKAPURA": (30.5828, 74.8278),
    "KURALI": (30.8250, 76.5750),
    "KURUKSHETRA": (29.9695, 76.8783),
    "LOHIA KHAS": (31.1300, 75.1800),
    "LUDHIANA": (30.9010, 75.8573),
    "MACCHIWARA": (30.9125, 76.2000),
    "MAHENDERGARH": (28.0435, 76.1070),
    "MAHILPUR": (31.3283, 76.0461),
    "MALERKOTLA": (30.5256, 75.8895),
    "MALOUT": (30.1947, 74.4989),
    "MANSA": (29.9889, 75.3934),
    "MEHTAPUR": (31.1100, 75.5800),
    "MOGA": (30.8165, 75.1717),
    "MUBARKPUR": (30.5900, 76.8300),
    "MUKERIAN": (31.9547, 75.6178),
    "NADON": (31.7800, 76.3400),
    "NANGAL": (31.3850, 76.3769),
    "NARAINGARH": (30.4789, 77.1306),
    "NARIALA": (30.4500, 77.1000),
    "NARNAUL": (28.0435, 76.1070),
    "NASRALA": (31.5100, 75.8500),
    "NAUSHERA PANNUAN": (31.3800, 74.9200),
    "NAWANSHAHR": (31.1256, 76.1189),
    "NAWASHAR": (31.1256, 76.1189),
    "NIHAL SINGH WALA": (30.5900, 75.2800),
    "PATHANKOT": (32.2684, 75.6529),
    "PATIALA": (30.3398, 76.3869),
    "PATRAN": (29.9442, 76.0594),
    "PHAGWARA": (31.2240, 75.7708),
    "PUNNIA": (31.4200, 74.8800),
    "RAIKOT": (30.6517, 75.5975),
    "RAJA KA TALAB": (32.1800, 75.9200),
    "RAMAN MANDI": (29.9500, 74.9800),
    "RAMPURA": (30.2500, 75.2400),
    "RARA SAHIB": (30.6500, 75.9800),
    "RATIA": (29.6833, 75.5833),
    "RAYYA": (31.5400, 75.2200),
    "REWARI": (28.1887, 76.6186),
    "ROHTAK": (28.8955, 76.6066),
    "ROPAR": (30.9664, 76.5331),
    "SAFIDON": (29.4069, 76.6664),
    "SAMANA": (30.1500, 76.1900),
    "SHAHABAD": (30.1668, 76.8703),
    "SHRI GANGANAGAR": (29.9094, 73.8799),
    "SIRSA": (29.5349, 75.0289),
    "SMLAKHA": (29.2300, 77.0100),
    "SONIPAT": (28.9931, 77.0151),
    "SUDHAR": (30.7300, 75.6800),
    "SUJANPUR": (32.3200, 75.6200),
    "SULTANPUR LODHI": (31.2144, 75.1972),
    "SURATGARH": (29.3200, 73.9000),
    "TANDA": (31.6667, 75.6333),
    "TARN TARAN": (31.4520, 74.9270),
    "TOHANA": (29.7028, 75.9039),
    "TOLE MAZRA": (30.6800, 76.6200),
    "YAMUNANAGAR": (30.1290, 77.2674),
    "ZIRA": (30.9744, 74.9889),
}


def get_coordinates_for_location(
    city: str | None = None,
    district: str | None = None,
    state: str | None = None,
) -> tuple[float, float]:
    """Resolves coordinates with city -> district -> state fallback hierarchy."""
    c_clean = (city or "").strip().upper()
    d_clean = (district or "").strip().upper()
    s_clean = (state or "").strip().upper()

    # 1. Check City
    if c_clean in CITY_COORDINATES:
        return CITY_COORDINATES[c_clean]

    # Partial city match
    for k, v in CITY_COORDINATES.items():
        if k in c_clean or c_clean in k:
            return v

    # 2. Check District
    if d_clean in DISTRICT_COORDINATES:
        return DISTRICT_COORDINATES[d_clean]

    for k, v in DISTRICT_COORDINATES.items():
        if k in d_clean or d_clean in k:
            return v

    # 3. Check State
    if s_clean in STATE_CENTERS:
        return STATE_CENTERS[s_clean]

    for k, v in STATE_CENTERS.items():
        if k in s_clean or s_clean in k:
            return v

    return STATE_CENTERS["INDIA"]


def get_district_coverage_info(db_path: str = "data/operations.db") -> list[dict[str, Any]]:
    """Calculates coverage, shops count, and active salesperson per district."""
    coverage_map: dict[str, dict[str, Any]] = {}

    # Initialize all known districts with coordinates
    for dist, coords in DISTRICT_COORDINATES.items():
        state = "Punjab" if coords[0] > 30.5 and coords[1] < 76.5 else "Haryana"
        if dist in ["HANUMANGARH", "GANGANAGAR"]:
            state = "Rajasthan"
        elif dist in ["H.P.", "NADON"]:
            state = "Himachal Pradesh"
        elif dist == "JAMMU":
            state = "Jammu"

        coverage_map[dist] = {
            "district": dist,
            "state": state,
            "lat": coords[0],
            "lng": coords[1],
            "totalShops": 0,
            "assignedSalesperson": None,
            "salespersonId": None,
            "salespersons": set(),
            "status": "vacant",  # 'assigned', 'partial', 'vacant'
            "cities": set(),
        }

    # Query parties database if available
    if os.path.exists(db_path):
        try:
            conn = sqlite3.connect(db_path)
            c = conn.cursor()
            c.execute("SELECT name, city, district, state, salesperson, salesperson_id FROM parties")
            for row in c.fetchall():
                _, city, dist, st, sp, sp_id = row
                d_key = (dist or "").strip().upper()
                if not d_key:
                    continue

                if d_key not in coverage_map:
                    coords = get_coordinates_for_location(city, dist, st)
                    coverage_map[d_key] = {
                        "district": d_key,
                        "state": st or "Haryana",
                        "lat": coords[0],
                        "lng": coords[1],
                        "totalShops": 0,
                        "assignedSalesperson": None,
                        "salespersonId": None,
                        "salespersons": set(),
                        "status": "vacant",
                        "cities": set(),
                    }

                entry = coverage_map[d_key]
                entry["totalShops"] += 1
                if city:
                    entry["cities"].add(city.strip())
                if sp and sp.strip() and sp.strip().lower() != "unassigned":
                    entry["salespersons"].add(sp.strip())
                    if not entry["assignedSalesperson"]:
                        entry["assignedSalesperson"] = sp.strip()
                        entry["salespersonId"] = sp_id

            conn.close()
        except Exception as e:
            print(f"Warning reading district coverage: {e}")

    # Determine status
    result = []
    for item in coverage_map.values():
        sp_count = len(item["salespersons"])
        if item["totalShops"] == 0 or sp_count == 0:
            item["status"] = "vacant"
        elif sp_count == 1:
            item["status"] = "assigned"
        else:
            item["status"] = "partial"

        item["salespersons"] = list(item["salespersons"])
        item["cities"] = list(item["cities"])
        result.append(item)

    return sorted(result, key=lambda x: (x["state"], x["district"]))
