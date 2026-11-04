import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8010/api/v1';

test('Security & Auth Suite: End-to-End Web & APK Flow', async (t) => {
  const uid = Math.random().toString(36).substring(2, 8).toUpperCase();
  const testEmail = `staff_${uid.toLowerCase()}@steeloperations.com`;
  const testPhone = `9814${Math.floor(100000 + Math.random() * 900000)}`;
  const password = `StrongPass_${uid}!`;
  const newPassword = `NewStrongPass_${uid}@`;
  let inviteCode = '';
  let accessToken = '';

  await t.test('1. Owner generates invitation code with specific territory & quota', async () => {
    const ownerToken = 'jwt-access-token-owner-owner';
    const res = await fetch(`${BASE_URL}/auth/invitations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({
        role: 'employee',
        department: 'Sales',
        salesTerritory: 'Ludhiana/Punjab',
        monthlyTargetQty: 180.0,
        targetUnit: 'MT',
        mayDispatch: false,
        maxUses: 1,
        expiresInDays: 7,
      }),
    });
    assert.equal(res.status, 200, `Expected 200, got ${res.status}`);
    const data = await res.json();
    assert.ok(data.code && data.code.startsWith('DURA-'), 'Code must start with DURA-');
    assert.equal(data.department, 'Sales');
    assert.equal(data.sales_territory, 'Ludhiana/Punjab');
    assert.equal(data.status, 'active');
    inviteCode = data.code;
  });

  await t.test('2. Public code verification accurately extracts configured roles & territory', async () => {
    const res = await fetch(`${BASE_URL}/auth/invitations/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: inviteCode }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.valid, true);
    assert.equal(data.department, 'Sales');
    assert.equal(data.salesTerritory, 'Ludhiana/Punjab');
    assert.equal(data.monthlyTargetQty, 180.0);
  });

  await t.test('3. Invalid or spoofed invite code is cleanly rejected', async () => {
    const res = await fetch(`${BASE_URL}/auth/invitations/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FAKE-CODE-9999' }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.valid, false);
    assert.ok(data.reason, 'Must return rejection reason');
  });

  await t.test('4. Staff registration persists salted hash user and issues JWT', async () => {
    const res = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `Testing Officer ${uid}`,
        identifier: testEmail,
        password: password,
        phone: testPhone,
        inviteCode: inviteCode,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.accessToken, 'Must issue accessToken');
    assert.equal(data.user.email, testEmail);
    assert.equal(data.user.department, 'Sales');
    accessToken = data.accessToken;
  });

  await t.test('5. Re-registering with the same invitation code fails (exhaustion)', async () => {
    const res = await fetch(`${BASE_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Intruder Trying Exhausted Code',
        identifier: `intruder_${uid.toLowerCase()}@test.com`,
        password: 'SomePassword123',
        phone: '9814000000',
        inviteCode: inviteCode,
      }),
    });
    assert.equal(res.status, 400, 'Must reject exhausted code with 400');
  });

  await t.test('6. Login with WRONG password is strictly rejected with 401', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: 'IncorrectPassword!',
      }),
    });
    assert.equal(res.status, 401, 'Must reject invalid password with 401');
    const data = await res.json();
    assert.equal(data.detail, 'Incorrect password');
  });

  await t.test('7. Login with CORRECT password succeeds with verified user profile', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: password,
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.accessToken);
    assert.equal(data.user.email, testEmail);
    assert.equal(data.user.phone, testPhone);
    assert.equal(data.user.name, `Testing Officer ${uid}`);
  });

  await t.test('8. GET /api/v1/auth/me returns authentic profile telemetry', async () => {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.email, testEmail);
    assert.equal(data.phone, testPhone);
    assert.equal(data.department, 'Sales');
  });

  await t.test('9. Password change with wrong current password fails', async () => {
    const res = await fetch(`${BASE_URL}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'WrongCurrentPassword',
        newPassword: newPassword,
      }),
    });
    assert.equal(res.status, 400, 'Must reject invalid current password');
  });

  await t.test('10. Password change with correct current password succeeds and works on next login', async () => {
    const updateRes = await fetch(`${BASE_URL}/auth/me`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: password,
        newPassword: newPassword,
      }),
    });
    assert.equal(updateRes.status, 200);

    // Old password must now fail
    const oldLogin = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: password,
      }),
    });
    assert.equal(oldLogin.status, 401, 'Old password must be revoked');

    // New password must succeed
    const newLogin = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: testEmail,
        password: newPassword,
      }),
    });
    assert.equal(newLogin.status, 200, 'New password must succeed');
  });
});
