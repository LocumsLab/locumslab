/**
 * REQUIRED SETUP — replace both values below before deploying.
 *
 * Get these from your Supabase project dashboard:
 *   Project Settings → API → Project URL
 *   Project Settings → API → Project API keys → "anon" "public" key
 *
 * The anon key is meant to be public (it ships in this file, visible to
 * anyone) — that's normal and safe as long as supabase_setup.sql has been
 * run, since that file locks down every table/function so the anon key can
 * only do exactly what's intended (create an offer, read one by its exact
 * token, edit one by its exact edit token — nothing else).
 */
window.LOCUMSLAB_CONFIG = {
  supabaseUrl: 'https://gqhalfzmqzlichcqubbs.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdxaGFsZnptcXpsaWNoY3F1YmJzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1MDcwMDQsImV4cCI6MjA4NzA4MzAwNH0.XdJ0dZXbLPeRy0oIQ8SFllx1lAYr_KhaA0VBay1E7pU',
  fullComparisonUrl: 'https://locumslab.com/app.html?panel=staff-locums'
};
