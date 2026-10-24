import assert from "node:assert/strict";
import test from "node:test";
import { adminHeaders, api, startTestApp } from "./helpers.js";

test("named staff sessions keep the admin token and limit desk roles", async () => {
  const app = await startTestApp({ STAFF_TOKEN: "test-staff-token-0123456789" });
  try {
    const created = await api(app.baseUrl, "/api/admin/staff", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        username: "ada",
        password: "a-long-password",
        displayName: "Ada",
        role: "owner",
      }),
    });
    assert.equal(created.status, 201);
    const ownerId = (created.body.staff as { id: string }).id;

    const desk = await api(app.baseUrl, "/api/admin/staff", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        username: "front",
        password: "another-long-password",
        displayName: "Front",
        role: "front-desk",
      }),
    });
    assert.equal(desk.status, 201);
    const coach = await api(app.baseUrl, "/api/admin/staff", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        username: "coach",
        password: "coach-password-1",
        displayName: "Coach",
        role: "coach",
      }),
    });
    assert.equal(coach.status, 201);

    const login = await api(app.baseUrl, "/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "ada", password: "a-long-password" }),
    });
    assert.equal(login.status, 200);
    const token = login.body.token as string;
    assert.equal(typeof token, "string");
    const sessionHeaders = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const courts = await api(app.baseUrl, "/api/admin/courts", { headers: sessionHeaders });
    assert.equal(courts.status, 200);

    const deskLogin = await api(app.baseUrl, "/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "front", password: "another-long-password" }),
    });
    const deskToken = deskLogin.body.token as string;
    const deskAdmin = await api(app.baseUrl, "/api/admin/courts", {
      headers: { authorization: `Bearer ${deskToken}` },
    });
    assert.equal(deskAdmin.status, 401);
    const deskOnsite = await api(app.baseUrl, "/api/staff/onsite", {
      headers: { authorization: `Bearer ${deskToken}` },
    });
    assert.equal(deskOnsite.status, 200);

    const coachLogin = await api(app.baseUrl, "/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "coach", password: "coach-password-1" }),
    });
    const coachAdmin = await api(app.baseUrl, "/api/admin/staff", {
      headers: { authorization: `Bearer ${coachLogin.body.token as string}` },
    });
    assert.equal(coachAdmin.status, 401);

    const manager = await api(app.baseUrl, "/api/admin/staff", {
      method: "POST",
      headers: sessionHeaders,
      body: JSON.stringify({
        username: "mgr",
        password: "manager-password",
        displayName: "Manager",
        role: "manager",
      }),
    });
    assert.equal(manager.status, 201);
    const managerLogin = await api(app.baseUrl, "/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "mgr", password: "manager-password" }),
    });
    const ownerAttempt = await api(app.baseUrl, "/api/admin/staff", {
      method: "POST",
      headers: {
        authorization: `Bearer ${managerLogin.body.token as string}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        username: "second-owner",
        password: "owner-password-2",
        displayName: "Second",
        role: "owner",
      }),
    });
    assert.equal(ownerAttempt.status, 403);

    const legacy = await api(app.baseUrl, "/api/admin/config", { headers: adminHeaders() });
    assert.equal(legacy.status, 200);
    const legacyStaff = await api(app.baseUrl, "/api/staff/onsite", {
      headers: { authorization: "Bearer test-staff-token-0123456789" },
    });
    assert.equal(legacyStaff.status, 200);

    const disabled = await api(app.baseUrl, `/api/admin/staff/${ownerId}/disable`, {
      method: "POST",
      headers: adminHeaders(),
    });
    assert.equal(disabled.status, 200);
    const after = await api(app.baseUrl, "/api/admin/courts", { headers: sessionHeaders });
    assert.equal(after.status, 401);
  } finally {
    await app.close();
  }
});
