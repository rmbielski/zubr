# ForageWatch product boundary and clean-room audit

Audit date: 2026-10-12

This document records observable StockSmart product behavior, the Zubr proposal requirements that shape ForageWatch, and the boundary between the functional browser application and services that do not yet exist. It excludes account details, authentication material, exact third-party project geometry, private project metadata, downloaded application source, and proprietary visual assets.

## Product direction

ForageWatch is not a StockSmart clone. StockSmart informed the shape of a practical geospatial workflow: select land, configure a source, request an analysis, inspect layers, and retain the project. Zubr's product focus is forage intelligence built around biomass and forage chemistry.

The primary target layers are:

- Biomass from satellite or UAV observations
- Crude protein / nitrogen from calibrated UAV hyperspectral data
- Neutral detergent fiber (NDF) from calibrated UAV hyperspectral data
- Silica from calibrated UAV hyperspectral data
- Bio-Invaders detection, beginning with *Ventenata dubia*
- Model uncertainty and provenance for every predicted layer

The proposed access boundary is also different. Public users can prepare satellite-based biomass requests with open imagery sources. Authenticated projects will hold private UAV captures, field samples, land history, chemistry products, downloadable reports, and organization access.

## Functional in the current homepage

The homepage now contains an independently written geospatial application shell rather than a numerical fixture.

- Live satellite imagery and OpenStreetMap basemaps
- Leaflet map navigation and browser geolocation
- Polygon and rectangle drawing
- Boundary editing and deletion
- GeoJSON Polygon and MultiPolygon import
- GeoJSON boundary export
- Geodesic area calculation in acres
- Multiple pasture geometries in one local project
- Named multi-pasture projects with per-pasture acreage and removal
- Project name, imagery source, automatic acquisition policy, field season, selected metrics, herd inputs, basemap, and geometry persistence in browser storage
- Public satellite and UAV-detail modes
- UAV file-type validation and browser-session staging for GeoTIFF, LAS/LAZ, or ZIP captures
- Biomass, protein/N, NDF, silica, and *Ventenata dubia* request configuration
- Automatic latest-viable satellite acquisition for the current-condition workflow
- Animal class, head count, weight, grazing period, allowable-use inputs, and local AUM demand calculation
- Honest request validation and pipeline status
- Explicit `No approved model available` failure at inference, without synthetic results
- Explicit private-workspace boundary without a fake login

No uploaded UAV file bytes leave the browser. Only the selected file's name, size, and type are remembered as metadata; the file must be reselected after a reload.

## Deliberately unavailable

The current repository is a static site. The following capabilities require production services and are not simulated:

- User accounts, organizations, roles, and secure sharing
- Cloud project storage and object storage for UAV data
- Satellite catalog search and scene acquisition
- Atmospheric correction, cloud masking, compositing, and reprojection
- UAV orthomosaic, hyperspectral cube, and LiDAR processing
- Calibrated biomass, protein/N, NDF, silica, or invasive-plant model inference
- Model registry, validation thresholds, versioning, and audit provenance
- Raster tile generation and modeled result layers
- Background-job queues, retries, notifications, and failure recovery
- Printable reports, share links, and organization dashboards

The user can therefore complete a project setup and submit a structurally valid request. The application stops at model inference and states that no approved model is installed. It never substitutes fixture values for a scientific output.

## Observed StockSmart workflow

The authorized review showed a project/scenario workflow that combines geometry, forage data, land and animal assumptions, raster jobs, uncertainty ranges, map layers, scenario comparison, and exports. Those product concepts informed the workflow ergonomics only. No third-party source code, private data, visual assets, credentials, or backend services are used by ForageWatch.

## Recommended service architecture

A production implementation can keep the current public map as the entry point and move authenticated projects to a typed application route. A practical system would combine a TypeScript web client, Postgres/PostGIS, private object storage, an imagery-catalog service, and Python geospatial workers using GDAL/rasterio. Prediction runs should be immutable and versioned so every result identifies its input boundary, source scenes or UAV capture, calibration dataset, model version, validation metrics, and uncertainty method.

Suggested primary entities are organizations, memberships, projects, sites, observation sources, field campaigns, samples, UAV assets, source scenes, model versions, immutable analysis runs, raster products, reports, and audit events.

## Public methodology references

- https://www.stock-smart.com/about-data
- https://research.fs.usda.gov/rmrs/products/dataandtools/stocksmart
- https://research.fs.usda.gov/rmrs/products/dataandtools/rangeland-production-monitoring-service-season-forage-and-fuel
- https://csanr.wsu.edu/projects/stocksmart/

These sources describe RPMS production estimates, vegetation-cover inputs, and StockSmart's role as a decision-support tool. Product behavior beyond those public descriptions was documented only from the user-authorized session.
