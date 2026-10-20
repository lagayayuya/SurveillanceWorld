"""Participation API (phase D1): live field preview, contributions, review.

Runs on the server behind Caddy, on 127.0.0.1 only. Imports only light modules (shapely,
numpy, pyproj, yaml, psycopg): never geopandas, pandas or pyarrow, so it stays small.
"""
