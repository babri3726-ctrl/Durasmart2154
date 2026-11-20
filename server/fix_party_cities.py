import sqlite3
import re

CITIES_MAP = [
    # (Regex pattern, City, District, State)
    (r"\b(ludhiana|ldh)\b", "Ludhiana", "Ludhiana", "Punjab"),
    (r"\b(amritsar|amritsir|asr)\b", "Amritsar", "Amritsar", "Punjab"),
    (r"\b(jalandhar|jal)\b", "Jalandhar", "Jalandhar", "Punjab"),
    (r"\b(bathinda|bhatinda)\b", "Bathinda", "Bathinda", "Punjab"),
    (r"\b(patiala)\b", "Patiala", "Patiala", "Punjab"),
    (r"\b(hoshiarpur|hosiarpur)\b", "Hoshiarpur", "Hoshiarpur", "Punjab"),
    (r"\b(moga)\b", "Moga", "Moga", "Punjab"),
    (r"\b(batala)\b", "Batala", "Gurdaspur", "Punjab"),
    (r"\b(pathankot)\b", "Pathankot", "Pathankot", "Punjab"),
    (r"\b(mohalli|mohali|sas nagar)\b", "Mohali", "Mohali", "Punjab"),
    (r"\b(abohar)\b", "Abohar", "Fazilka", "Punjab"),
    (r"\b(malerkotla)\b", "Malerkotla", "Malerkotla", "Punjab"),
    (r"\b(khanna)\b", "Khanna", "Ludhiana", "Punjab"),
    (r"\b(muktsar|sri muktsar sahib)\b", "Muktsar", "Muktsar", "Punjab"),
    (r"\b(barnala)\b", "Barnala", "Barnala", "Punjab"),
    (r"\b(rajpura)\b", "Rajpura", "Patiala", "Punjab"),
    (r"\b(ferozepur|ferojpur|firozpur)\b", "Ferozepur", "Ferozepur", "Punjab"),
    (r"\b(kapurthala)\b", "Kapurthala", "Kapurthala", "Punjab"),
    (r"\b(sunam)\b", "Sunam", "Sangrur", "Punjab"),
    (r"\b(mansa)\b", "Mansa", "Mansa", "Punjab"),
    (r"\b(fazilka)\b", "Fazilka", "Fazilka", "Punjab"),
    (r"\b(gurdaspur)\b", "Gurdaspur", "Gurdaspur", "Punjab"),
    (r"\b(sangrur)\b", "Sangrur", "Sangrur", "Punjab"),
    (r"\b(faridkot)\b", "Faridkot", "Faridkot", "Punjab"),
    (r"\b(nawanshahr|nawashar)\b", "Nawanshahr", "Nawanshahr", "Punjab"),
    (r"\b(tarn taran|tarantarn|taran taran)\b", "Tarn Taran", "Tarn Taran", "Punjab"),
    (r"\b(ropar|rupnagar)\b", "Ropar", "Ropar", "Punjab"),
    (r"\b(sirhind|fatehgarh sahib)\b", "Sirhind", "Fatehgarh Sahib", "Punjab"),
    (r"\b(nakodar)\b", "Nakodar", "Jalandhar", "Punjab"),
    (r"\b(phagwara)\b", "Phagwara", "Kapurthala", "Punjab"),
    (r"\b(jagraon|jagroun)\b", "Jagraon", "Ludhiana", "Punjab"),
    (r"\b(samana)\b", "Samana", "Patiala", "Punjab"),
    (r"\b(nabha)\b", "Nabha", "Patiala", "Punjab"),
    (r"\b(patti)\b", "Patti", "Tarn Taran", "Punjab"),
    (r"\b(kotkapura|kot kapura)\b", "Kotkapura", "Faridkot", "Punjab"),
    (r"\b(morinda)\b", "Morinda", "Ropar", "Punjab"),
    (r"\b(dhuri)\b", "Dhuri", "Sangrur", "Punjab"),
    (r"\b(gobindgarh|mandi gobindgarh)\b", "Mandi Gobindgarh", "Fatehgarh Sahib", "Punjab"),
    (r"\b(rampuraphul|rampura phul|rampura)\b", "Rampura Phul", "Bathinda", "Punjab"),
    (r"\b(baghapurana|bagha purana)\b", "Baghapurana", "Moga", "Punjab"),
    (r"\b(budhlada)\b", "Budhlada", "Mansa", "Punjab"),
    (r"\b(patran)\b", "Patran", "Patiala", "Punjab"),
    (r"\b(machiwara|machhiwara)\b", "Machhiwara", "Ludhiana", "Punjab"),
    (r"\b(doraha)\b", "Doraha", "Ludhiana", "Punjab"),
    (r"\b(sahnewal)\b", "Sahnewal", "Ludhiana", "Punjab"),
    (r"\b(dehlo|dehlon)\b", "Dehlon", "Ludhiana", "Punjab"),
    (r"\b(goraya)\b", "Goraya", "Jalandhar", "Punjab"),
    (r"\b(shahkot)\b", "Shahkot", "Jalandhar", "Punjab"),
    (r"\b(dasuya)\b", "Dasuya", "Hoshiarpur", "Punjab"),
    (r"\b(mukerian)\b", "Mukerian", "Hoshiarpur", "Punjab"),
    (r"\b(tanda|urmar tanda)\b", "Tanda", "Hoshiarpur", "Punjab"),
    (r"\b(banga)\b", "Banga", "Nawanshahr", "Punjab"),
    (r"\b(balachaur|balachour)\b", "Balachaur", "Nawanshahr", "Punjab"),
    (r"\b(kot ise khan)\b", "Kot Ise Khan", "Moga", "Punjab"),
    (r"\b(nihal singh wala)\b", "Nihal Singh Wala", "Moga", "Punjab"),
    (r"\b(dharamkot)\b", "Dharamkot", "Moga", "Punjab"),
    (r"\b(zeera|zira)\b", "Zira", "Ferozepur", "Punjab"),
    (r"\b(jalalabad)\b", "Jalalabad", "Fazilka", "Punjab"),
    (r"\b(malout)\b", "Malout", "Muktsar", "Punjab"),
    (r"\b(gidderbaha)\b", "Gidderbaha", "Muktsar", "Punjab"),
    (r"\b(kalianwali|kalia wali|kalanwali)\b", "Kalanwali", "Sirsa", "Haryana"),
    (r"\b(mandi dabwali|dabwali)\b", "Mandi Dabwali", "Sirsa", "Haryana"),
    (r"\b(maur mandi|maur)\b", "Maur Mandi", "Bathinda", "Punjab"),
    (r"\b(talwandi sabo)\b", "Talwandi Sabo", "Bathinda", "Punjab"),
    (r"\b(sardulgarh)\b", "Sardulgarh", "Mansa", "Punjab"),
    (r"\b(bareta)\b", "Bareta", "Mansa", "Punjab"),
    (r"\b(bhikhi)\b", "Bhikhi", "Mansa", "Punjab"),
    (r"\b(lehragaga|lehra gaga)\b", "Lehragaga", "Sangrur", "Punjab"),
    (r"\b(moonak)\b", "Moonak", "Sangrur", "Punjab"),
    (r"\b(ahmedgarh)\b", "Ahmedgarh", "Malerkotla", "Punjab"),
    (r"\b(amloh)\b", "Amloh", "Fatehgarh Sahib", "Punjab"),
    (r"\b(khamanon)\b", "Khamanon", "Fatehgarh Sahib", "Punjab"),
    (r"\b(chamkaur sahib)\b", "Chamkaur Sahib", "Ropar", "Punjab"),
    (r"\b(anandpur sahib)\b", "Anandpur Sahib", "Ropar", "Punjab"),
    (r"\b(derabassi|dera bassi)\b", "Dera Bassi", "Mohali", "Punjab"),
    (r"\b(kharar)\b", "Kharar", "Mohali", "Punjab"),
    (r"\b(kurali)\b", "Kurali", "Mohali", "Punjab"),
    (r"\b(zirakpur)\b", "Zirakpur", "Mohali", "Punjab"),
    (r"\b(khanauri|khanuri|khanouri)\b", "Khanauri", "Sangrur", "Punjab"),

    # Haryana Cities
    (r"\b(faridabad)\b", "Faridabad", "Faridabad", "Haryana"),
    (r"\b(ballabgarh|ballabhgarh)\b", "Ballabgarh", "Faridabad", "Haryana"),
    (r"\b(gurugram|gurgaon)\b", "Gurugram", "Gurugram", "Haryana"),
    (r"\b(panipat)\b", "Panipat", "Panipat", "Haryana"),
    (r"\b(ambala)\b", "Ambala", "Ambala", "Haryana"),
    (r"\b(yamunanagar|jagadhri)\b", "Yamunanagar", "Yamunanagar", "Haryana"),
    (r"\b(rohtak)\b", "Rohtak", "Rohtak", "Haryana"),
    (r"\b(hisar|hissar)\b", "Hisar", "Hisar", "Haryana"),
    (r"\b(karnal)\b", "Karnal", "Karnal", "Haryana"),
    (r"\b(sonipat|sonepat)\b", "Sonipat", "Sonipat", "Haryana"),
    (r"\b(panchkula)\b", "Panchkula", "Panchkula", "Haryana"),
    (r"\b(bhiwani)\b", "Bhiwani", "Bhiwani", "Haryana"),
    (r"\b(sirsa)\b", "Sirsa", "Sirsa", "Haryana"),
    (r"\b(bahadurgarh)\b", "Bahadurgarh", "Jhajjar", "Haryana"),
    (r"\b(jind)\b", "Jind", "Jind", "Haryana"),
    (r"\b(thanesar|kurukshetra)\b", "Kurukshetra", "Kurukshetra", "Haryana"),
    (r"\b(kaithal|kaitahl)\b", "Kaithal", "Kaithal", "Haryana"),
    (r"\b(rewari)\b", "Rewari", "Rewari", "Haryana"),
    (r"\b(palwal)\b", "Palwal", "Palwal", "Haryana"),
    (r"\b(hansi)\b", "Hansi", "Hisar", "Haryana"),
    (r"\b(narnaul|mahendragarh|mahendargarh)\b", "Narnaul", "Mahendragarh", "Haryana"),
    (r"\b(fatehabad)\b", "Fatehabad", "Fatehabad", "Haryana"),
    (r"\b(gohana)\b", "Gohana", "Sonipat", "Haryana"),
    (r"\b(tohana)\b", "Tohana", "Fatehabad", "Haryana"),
    (r"\b(narwana)\b", "Narwana", "Jind", "Haryana"),
    (r"\b(charkhi dadri|dadri)\b", "Charkhi Dadri", "Charkhi Dadri", "Haryana"),
    (r"\b(pehowa)\b", "Pehowa", "Kurukshetra", "Haryana"),
    (r"\b(shahabad)\b", "Shahabad", "Kurukshetra", "Haryana"),
    (r"\b(ladwa)\b", "Ladwa", "Kurukshetra", "Haryana"),
    (r"\b(cheeka)\b", "Cheeka", "Kaithal", "Haryana"),
    (r"\b(kalayat)\b", "Kalayat", "Kaithal", "Haryana"),
    (r"\b(samalkha)\b", "Samalkha", "Panipat", "Haryana"),
    (r"\b(assandh)\b", "Assandh", "Karnal", "Haryana"),
    (r"\b(gharaunda)\b", "Gharaunda", "Karnal", "Haryana"),
    (r"\b(taraori)\b", "Taraori", "Karnal", "Haryana"),
    (r"\b(nilokheri)\b", "Nilokheri", "Karnal", "Haryana"),
    (r"\b(indri)\b", "Indri", "Karnal", "Haryana"),
    (r"\b(barwala)\b", "Barwala", "Hisar", "Haryana"),
    (r"\b(safidon)\b", "Safidon", "Jind", "Haryana"),
    (r"\b(uchana)\b", "Uchana", "Jind", "Haryana"),
    (r"\b(ratia)\b", "Ratia", "Fatehabad", "Haryana"),
    (r"\b(jakhal)\b", "Jakhal", "Fatehabad", "Haryana"),
    (r"\b(bhattu)\b", "Bhattu Kalan", "Fatehabad", "Haryana"),
    (r"\b(meham)\b", "Meham", "Rohtak", "Haryana"),
    (r"\b(sampla)\b", "Sampla", "Rohtak", "Haryana"),
    (r"\b(kalanaur)\b", "Kalanaur", "Rohtak", "Haryana"),
    (r"\b(jhajjar)\b", "Jhajjar", "Jhajjar", "Haryana"),
    (r"\b(beri)\b", "Beri", "Jhajjar", "Haryana"),
    (r"\b(bawal)\b", "Bawal", "Rewari", "Haryana"),
    (r"\b(dharuhera)\b", "Dharuhera", "Rewari", "Haryana"),
    (r"\b(manesar)\b", "Manesar", "Gurugram", "Haryana"),
    (r"\b(sohna)\b", "Sohna", "Gurugram", "Haryana"),
    (r"\b(pataudi)\b", "Pataudi", "Gurugram", "Haryana"),
    (r"\b(nuh)\b", "Nuh", "Nuh", "Haryana"),
    (r"\b(taoru)\b", "Taoru", "Nuh", "Haryana"),
    (r"\b(ferozepur jhirka)\b", "Ferozepur Jhirka", "Nuh", "Haryana"),
    (r"\b(hathir|hathin)\b", "Hathin", "Palwal", "Haryana"),
    (r"\b(hodal)\b", "Hodal", "Palwal", "Haryana"),
    (r"\b(gannaur)\b", "Gannaur", "Sonipat", "Haryana"),
    (r"\b(kharkhoda)\b", "Kharkhoda", "Sonipat", "Haryana"),
    (r"\b(rai)\b", "Rai", "Sonipat", "Haryana"),
    (r"\b(kundli)\b", "Kundli", "Sonipat", "Haryana"),
    (r"\b(murthal)\b", "Murthal", "Sonipat", "Haryana"),

    # NCR / Rajasthan / HP border towns
    (r"\b(hanumangarh)\b", "Hanumangarh", "Hanumangarh", "Rajasthan"),
    (r"\b(ganganagar|sri ganganagar)\b", "Sri Ganganagar", "Sri Ganganagar", "Rajasthan"),
    (r"\b(delhi|new delhi)\b", "Delhi", "Delhi", "Delhi"),
    (r"\b(noida)\b", "Noida", "Gautam Buddha Nagar", "Uttar Pradesh"),
    (r"\b(ghaziabad|gbd)\b", "Ghaziabad", "Ghaziabad", "Uttar Pradesh"),
    (r"\b(mehatpur)\b", "Mehatpur", "Una", "Himachal Pradesh"),
]

def fix_all_party_cities(db_path="data/operations.db"):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    rows = list(c.execute("SELECT id, name, city, district, state FROM parties"))
    updated = 0
    for party_id, name, city, dist, st in rows:
        target_text = f"{name} {city or ''} {dist or ''}"
        found_city = None
        found_dist = None
        found_st = None
        for pattern, c_name, d_name, s_name in CITIES_MAP:
            if re.search(pattern, target_text, flags=re.IGNORECASE):
                found_city = c_name
                found_dist = d_name
                found_st = s_name
                break
        
        needs_update = False
        new_city = (city or "").strip()
        new_dist = (dist or "").strip()
        new_st = (st or "").strip() or "Punjab"

        if not new_city and found_city:
            new_city = found_city
            needs_update = True
        if not new_dist and found_dist:
            new_dist = found_dist
            needs_update = True
        if (not new_st or new_st in ("Punjab", "Haryana")) and found_st:
            if new_st != found_st:
                new_st = found_st
                needs_update = True

        # If district is still empty but city exists
        if not new_dist and new_city:
            for _, c_name, d_name, s_name in CITIES_MAP:
                if c_name.lower() == new_city.lower():
                    new_dist = d_name
                    new_st = s_name
                    needs_update = True
                    break

        if needs_update:
            c.execute(
                "UPDATE parties SET city = ?, district = ?, state = ?, updated_at = datetime('now') WHERE id = ?",
                (new_city, new_dist, new_st, party_id)
            )
            updated += 1

    conn.commit()
    conn.close()
    print(f"Total parties examined: {len(rows)}, successfully updated cities/districts: {updated}")

if __name__ == "__main__":
    fix_all_party_cities()
