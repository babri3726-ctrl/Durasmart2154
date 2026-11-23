/**
 * Offline Free Geographic Coordinate Gazetteer for Punjab, Haryana & Northern India.
 * Zero-latency, 100% free coordinate lookup for dealer shops.
 */

export const CITY_COORDINATES: Record<string, [number, number]> = {
  // Key Haryana Hubs
  AMBALA: [30.3782, 76.7767],
  FATEHABAD: [29.5161, 75.4542],
  GURUGRAM: [28.4595, 77.0266],
  GURGAON: [28.4595, 77.0266],
  HISAR: [29.1492, 75.7217],
  AGROHA: [29.3242, 75.6148],
  HANSI: [29.1022, 75.9619],
  JAKHAL: [29.7894, 75.8306],
  JHAJJAR: [28.6063, 76.6565],
  JIND: [29.315, 76.3154],
  KAITHAL: [29.8015, 76.3996],
  KARNAL: [29.6857, 76.9905],
  KURUKSHETRA: [29.9695, 76.8783],
  MAHENDRAGARH: [28.0435, 76.107],
  PANIPAT: [29.3909, 76.9635],
  PEHOWA: [29.9798, 76.5828],
  REWARI: [28.1887, 76.6186],
  ROHTAK: [28.8955, 76.6066],
  SIRSA: [29.5349, 75.0289],
  SONIPAT: [28.9931, 77.0151],
  YAMUNANAGAR: [30.129, 77.2674],
  FARIDABAD: [28.4089, 77.3178],
  BALLABGARH: [28.3414, 77.3245],
  DABWALI: [29.9575, 74.7246],
  NARWANA: [29.6105, 76.1219],
  TOHANA: [29.7042, 75.9015],
  CHEEKA: [29.9678, 76.2238],

  // Key Punjab Hubs
  ABOHAR: [30.1453, 74.1994],
  AMRITSAR: [31.634, 74.8723],
  BARNALA: [30.3819, 75.5466],
  BATALA: [31.8186, 75.2028],
  BATHINDA: [30.211, 74.9455],
  BHATINDA: [30.211, 74.9455],
  CHUNNI: [30.64, 76.54],
  DERA_BASSI: [30.5844, 76.8443],
  DERABASSI: [30.5844, 76.8443],
  DHARAMKOT: [30.9453, 75.2344],
  FARIDKOT: [30.6769, 74.7583],
  FAZILKA: [30.4037, 74.0254],
  FEROZPUR: [30.9237, 74.6133],
  FIROZPUR: [30.9237, 74.6133],
  GOBINDGARH: [30.6653, 76.2974],
  MANDI_GOBINDGARH: [30.6653, 76.2974],
  GURDASPUR: [32.0419, 75.4053],
  HOSHIARPUR: [31.5273, 75.9142],
  JALANDHAR: [31.326, 75.5762],
  KAPURTHALA: [31.3802, 75.3819],
  KHANNA: [30.7067, 76.219],
  KOTKAPURA: [30.5828, 74.8277],
  LUDHIANA: [30.901, 75.8573],
  MALERKOTLA: [30.5256, 75.8895],
  MANSA: [29.9889, 75.3934],
  MOGA: [30.8165, 75.1717],
  MOHALI: [30.7046, 76.7179],
  MUKTSAR: [30.4762, 74.5122],
  NAWANSHAHR: [31.1256, 76.1189],
  PATHANKOT: [32.2684, 75.6529],
  PATIALA: [30.3398, 76.3869],
  PHAGWARA: [31.224, 75.7708],
  ROPAR: [30.9664, 76.5331],
  RUPNAGAR: [30.9664, 76.5331],
  SAMRALA: [30.8354, 76.1925],
  SANGRUR: [30.2458, 75.8421],
  SUNAM: [30.129, 75.8016],
  TARN_TARAN: [31.452, 74.927],
  ZIRA: [30.9723, 74.9877],

  // Adjoining Hubs
  CHANDIGARH: [30.7333, 76.7794],
  DELHI: [28.6139, 77.209],
  GANGANAGAR: [29.9094, 73.8799],
  HANUMANGARH: [29.581, 74.3294],
};

export function getCoordinates(city?: string, district?: string): [number, number] {
  const norm = (s?: string) => (s || '').toUpperCase().trim().replace(/[^A-Z]/g, '_');
  const cKey = norm(city);
  const dKey = norm(district);

  if (cKey && CITY_COORDINATES[cKey]) return CITY_COORDINATES[cKey];
  if (dKey && CITY_COORDINATES[dKey]) return CITY_COORDINATES[dKey];

  // Partial substring match
  for (const [key, coords] of Object.entries(CITY_COORDINATES)) {
    if (cKey && (cKey.includes(key) || key.includes(cKey))) return coords;
    if (dKey && (dKey.includes(key) || key.includes(dKey))) return coords;
  }

  // Default: Ludhiana / Punjab centroid
  return [30.901, 75.8573];
}
