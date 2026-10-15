# iOS update feed

The iPhone app (private repo `mission-timeline-iOS`) reads `latest.json` from GitHub Pages on launch and shows an update banner when `version` is newer than the installed one.

To announce a release: bump `version`, write the `notes`, point `url` at the build (TestFlight link or release page), and push. The app picks it up on its next launch or when it returns to the foreground after 6 hours.
