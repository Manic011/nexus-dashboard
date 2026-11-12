# Homelab web ports

These are common defaults or deployment mappings. A port can serve several products, and a reverse proxy can move any service to 80 or 443. Nexus treats port matches as suggestions. It labels a result with a product name when a recognizable page title is available.

| Service | Category | TCP ports |
| --- | --- | --- |
| Jellyfin | Media | 8096, 8920 |
| Emby | Media | 8096, 8920 |
| Plex | Media | 32400 |
| Immich | Photos | 2283 |
| PhotoPrism | Photos | 2342 |
| Audiobookshelf | Media | 13378 |
| Navidrome | Media | 4533 |
| Tautulli | Media | 8181 |
| Sonarr | Media automation | 8989 |
| Radarr | Media automation | 7878 |
| Lidarr | Media automation | 8686 |
| Readarr | Media automation | 8787 |
| Prowlarr | Media automation | 9696 |
| Bazarr | Media automation | 6767 |
| Seerr | Media automation | 5055 |
| Overseerr | Media automation | 5055 |
| Jellyseerr | Media automation | 5055 |
| Jackett | Media automation | 9117 |
| qBittorrent | Downloads | 8080 |
| SABnzbd | Downloads | 8080 |
| Transmission | Downloads | 9091 |
| Deluge | Downloads | 8112 |
| NZBGet | Downloads | 6789 |
| Proxmox VE | Infrastructure | 8006 |
| Proxmox Backup Server | Infrastructure | 8007 |
| Portainer | Infrastructure | 9443, 9000 |
| OpenMediaVault | Infrastructure | 80, 443 |
| TrueNAS | Infrastructure | 80, 443 |
| Synology DiskStation | Infrastructure | 5000, 5001 |
| Cockpit | Infrastructure | 9090 |
| Home Assistant | Home automation | 8123 |
| Node-RED | Home automation | 1880 |
| openHAB | Home automation | 8080, 8443 |
| Grafana | Monitoring | 3000 |
| Prometheus | Monitoring | 9090 |
| Uptime Kuma | Monitoring | 3001 |
| Netdata | Monitoring | 19999 |
| Glances | Monitoring | 61208 |
| Pi-hole | Networking | 80, 443 |
| AdGuard Home | Networking | 3000, 80, 443 |
| Nginx Proxy Manager | Networking | 81 |
| Traefik | Networking | 8080 |
| Gitea | Development | 3000 |
| Forgejo | Development | 3000 |
| Nextcloud | Productivity | 80, 443 |
| Vaultwarden | Productivity | 80, 443 |
| Syncthing | Storage | 8384 |
| MinIO | Storage | 9000, 9001 |
| Frigate | Cameras | 8971, 5000 |
| Homebridge | Home automation | 8581 |

See [Jellyfin networking](https://jellyfin.org/docs/general/post-install/networking/), [Proxmox VE administration](https://pve.proxmox.com/pve-docs-8/pve-admin-guide.pdf), [Proxmox Backup Server](https://pbs.proxmox.com/docs/proxmox-backup.pdf), [Servarr](https://wiki.servarr.com/), [Home Assistant](https://www.home-assistant.io/docs/configuration/remote/), [Grafana](https://grafana.com/docs/grafana/latest/setup-grafana/installation/windows/), and [Portainer](https://docs.portainer.io/start/upgrade).
