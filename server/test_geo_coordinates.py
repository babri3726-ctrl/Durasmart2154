import unittest
from server.geo_coordinates import (
    get_coordinates_for_location,
    DISTRICT_COORDINATES,
    CITY_COORDINATES,
    get_district_coverage_info,
)

class TestGeoCoordinates(unittest.TestCase):
    def test_district_coordinates_exist(self):
        # Must have coordinates for key Haryana and Punjab districts
        self.assertIn("SIRSA", DISTRICT_COORDINATES)
        self.assertIn("LUDHIANA", DISTRICT_COORDINATES)
        self.assertIn("AMBALA", DISTRICT_COORDINATES)
        self.assertIn("JALANDHAR", DISTRICT_COORDINATES)
        self.assertIn("BATHINDA", DISTRICT_COORDINATES)
        self.assertIn("KURUKSHETRA", DISTRICT_COORDINATES)

        lat, lng = DISTRICT_COORDINATES["SIRSA"]
        self.assertTrue(29.0 <= lat <= 30.5)
        self.assertTrue(74.5 <= lng <= 76.0)

    def test_city_coordinates_exist(self):
        # Must have coordinates for key cities / towns
        self.assertIn("DABWALI", CITY_COORDINATES)
        self.assertIn("DERA BASSI", CITY_COORDINATES)
        self.assertIn("BAHADURGARH", CITY_COORDINATES)
        self.assertIn("NARAINGARH", CITY_COORDINATES)

    def test_get_coordinates_resolution(self):
        # Exact city match
        coords = get_coordinates_for_location(city="Dabwali", district="Sirsa", state="Haryana")
        self.assertIsNotNone(coords)
        self.assertEqual(len(coords), 2)

        # Fallback to district if city is unknown
        coords_dist = get_coordinates_for_location(city="Unknown Village", district="Ludhiana", state="Punjab")
        self.assertIsNotNone(coords_dist)
        lat, lng = coords_dist
        self.assertTrue(30.5 <= lat <= 31.5)

        # Fallback to state center if district is unknown
        coords_state = get_coordinates_for_location(city="Nowhere", district="Nowhere", state="Haryana")
        self.assertIsNotNone(coords_state)

    def test_district_coverage_calculation(self):
        info = get_district_coverage_info()
        self.assertIsInstance(info, list)
        self.assertGreater(len(info), 30)
        # Each item must have district, state, lat, lng, totalShops, assignedSalesperson, status
        sample = info[0]
        self.assertIn("district", sample)
        self.assertIn("state", sample)
        self.assertIn("lat", sample)
        self.assertIn("lng", sample)
        self.assertIn("status", sample)

if __name__ == '__main__':
    unittest.main()
