import { expect, test } from "vitest";
import { resolveChildIdentity } from "../scripts/migrate-to-team.js";

test("resolveChildIdentity returns null when CHILD_CHAT_ID is missing", () => {
  expect(resolveChildIdentity({ CHILD_NAME: "Саша" })).toBeNull();
});

test("resolveChildIdentity returns null when CHILD_NAME is missing", () => {
  expect(resolveChildIdentity({ CHILD_CHAT_ID: "42" })).toBeNull();
});

test("resolveChildIdentity returns null when CHILD_CHAT_ID does not parse to a number", () => {
  expect(resolveChildIdentity({ CHILD_CHAT_ID: "abc", CHILD_NAME: "Саша" })).toBeNull();
});

test("resolveChildIdentity returns null when both variables are missing", () => {
  expect(resolveChildIdentity({})).toBeNull();
});

test("resolveChildIdentity returns null when CHILD_CHAT_ID is whitespace-only", () => {
  expect(resolveChildIdentity({ CHILD_CHAT_ID: "   ", CHILD_NAME: "Саша" })).toBeNull();
});

test("resolveChildIdentity returns null when CHILD_CHAT_ID is 0", () => {
  expect(resolveChildIdentity({ CHILD_CHAT_ID: "0", CHILD_NAME: "Саша" })).toBeNull();
});

test("resolveChildIdentity returns null when CHILD_NAME is whitespace-only", () => {
  expect(resolveChildIdentity({ CHILD_CHAT_ID: "42", CHILD_NAME: "   " })).toBeNull();
});

test("resolveChildIdentity returns the parsed identity when both variables are valid", () => {
  expect(resolveChildIdentity({ CHILD_CHAT_ID: "42", CHILD_NAME: "Саша" })).toEqual({ chatId: 42, name: "Саша" });
});
