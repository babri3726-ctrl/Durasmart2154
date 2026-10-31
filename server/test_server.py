import unittest
from fastapi.testclient import TestClient
from server.main import app

class TestServerApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_00_health(self):
        r = self.client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "healthy")

    def test_00_spa_index(self):
        r = self.client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("html", r.headers.get("content-type", "").lower())
        self.assertIn("<div id=\"root\"></div>", r.text)

    def test_01_login(self):
        r = self.client.post("/api/v1/auth/login", json={"username": "owner", "password": "demo"})
        self.assertEqual(r.status_code, 200, f"Login failed: {r.text}")
        data = r.json()
        self.assertIn("user", data)
        self.assertEqual(data["user"]["role"], "owner")

    def test_02_stock_watch(self):
        r = self.client.get("/api/v1/imports/excel/stock-watch")
        self.assertEqual(r.status_code, 200, f"Stock watch failed: {r.text}")
        data = r.json()
        self.assertIn("path", data)

    def test_03_stock_summary(self):
        r = self.client.get("/api/v1/stock/summary")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIn("categories", data)
        self.assertTrue(len(data["categories"]) > 0)

    def test_04_dashboard_summary(self):
        r = self.client.get("/api/v1/dashboard/summary")
        self.assertEqual(r.status_code, 200)

if __name__ == '__main__':
    unittest.main()
