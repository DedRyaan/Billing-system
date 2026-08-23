-- Migration 0001: extensions
-- pgcrypto powers setup-code hashing (D-01..D-04 bootstrap flow, later plan).
create extension if not exists pgcrypto;
