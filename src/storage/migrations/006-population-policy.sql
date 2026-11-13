-- 006-population-policy.sql — persist the optional social population target policy.
-- Existing towns retain legacy behavior: the policy is enabled by default.

alter table worlds add column population_policy_enabled integer not null default 1;
