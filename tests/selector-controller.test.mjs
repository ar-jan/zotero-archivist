import test from "node:test";
import assert from "node:assert/strict";

import {
  createNewSelectorRule,
  formatRuleHeading,
  validateSelectorRules
} from "../sidepanel/selector-controller.js";

test("selector validation rejects empty rule lists", () => {
  assert.equal(validateSelectorRules([]), "At least one selector rule is required.");
});

test("selector validation rejects duplicate ids", () => {
  const rules = [
    {
      id: "rule-1",
      cssSelector: "a[href]"
    },
    {
      id: "rule-1",
      cssSelector: "a[href]"
    }
  ];

  assert.equal(validateSelectorRules(rules), "Rule 2 has a duplicate id.");
});

test("selector validation rejects missing css selector", () => {
  const rules = [
    {
      id: "rule-1",
      cssSelector: ""
    }
  ];

  assert.equal(validateSelectorRules(rules), "Rule 1 must include a CSS selector.");
});

test("selector validation accepts well-formed rules", () => {
  const rules = [
    {
      id: "rule-1",
      cssSelector: "a[href]"
    }
  ];

  assert.equal(validateSelectorRules(rules), null);
});

test("new selector rules use generated ids and defaults", () => {
  const rule = createNewSelectorRule(() => "rule-123");

  assert.equal(rule.id, "rule-123");
  assert.equal(rule.name, "Custom rule");
  assert.equal(rule.cssSelector, "a[href]");
  assert.equal(rule.urlAttribute, "href");
  assert.equal(rule.enabled, true);
});

test("selector heading formatter prefers name then id", () => {
  assert.equal(formatRuleHeading("  Rule Name  ", "rule-1"), "Rule Name");
  assert.equal(formatRuleHeading("", "  rule-1  "), "rule-1");
  assert.equal(formatRuleHeading("", ""), "Unnamed rule");
});
