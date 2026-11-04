import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ServerTourVisit } from '../../lib/serverApi';

interface LeafletTourMapProps {
  visits: ServerTourVisit[];
  selectedVisitId?: string | null;
  onSelectVisit?: (visit: ServerTourVisit) => void;
  onUpdateStatus?: (visitId: string, status: 'planned' | 'in_progress' | 'completed' | 'missed') => void;
}

export default function LeafletTourMap({
  visits,
  selectedVisitId,
  onSelectVisit,
  onUpdateStatus,
}: LeafletTourMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      // Default center: Northern India (Haryana/Punjab centroid)
      const map = L.map(mapContainerRef.current, {
        center: [30.2, 75.8],
        zoom: 8,
        zoomControl: true,
      });

      // Free OpenStreetMap Standard Tile Layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const layerGroup = L.layerGroup().addTo(map);
      layerGroupRef.current = layerGroup;
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        layerGroupRef.current = null;
      }
    };
  }, []);

  // Update Markers & Polylines whenever visits change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const validVisits = visits.filter(
      (v) => typeof v.gpsLat === 'number' && typeof v.gpsLng === 'number' && !isNaN(v.gpsLat) && !isNaN(v.gpsLng),
    );

    if (validVisits.length === 0) {
      // Reset view to Haryana/Punjab
      map.setView([30.2, 75.8], 8);
      return;
    }

    // Sort by sequence for accurate route polyline
    const sortedVisits = [...validVisits].sort((a, b) => a.sequence - b.sequence);
    const latLngs: L.LatLngExpression[] = sortedVisits.map((v) => [v.gpsLat!, v.gpsLng!]);

    // Draw route polyline connecting sequential stops
    if (latLngs.length > 1) {
      const polyline = L.polyline(latLngs, {
        color: '#2563eb',
        weight: 3.5,
        opacity: 0.85,
        dashArray: '6, 8',
      });
      polyline.addTo(layerGroup);
    }

    const markers: L.Marker[] = [];

    sortedVisits.forEach((visit) => {
      const isSelected = visit.id === selectedVisitId;

      // Color coding per status
      let bgClass = 'bg-blue-600 text-white';
      let borderClass = 'border-white';
      if (visit.status === 'completed') {
        bgClass = 'bg-emerald-600 text-white';
      } else if (visit.status === 'in_progress') {
        bgClass = 'bg-amber-500 text-white';
      } else if (visit.status === 'missed') {
        bgClass = 'bg-red-600 text-white';
      }

      if (isSelected) {
        borderClass = 'border-amber-300 ring-4 ring-blue-500/30 scale-125';
      }

      // Custom HTML Numbered Pin
      const iconHtml = `
        <div class="relative flex items-center justify-center">
          <div class="w-7 h-7 rounded-full shadow-lg border-2 ${borderClass} ${bgClass} flex items-center justify-center font-bold text-[12px] transition-transform">
            ${visit.sequence}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-leaflet-marker',
        html: iconHtml,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        popupAnchor: [0, -14],
      });

      const marker = L.marker([visit.gpsLat!, visit.gpsLng!], { icon: customIcon });

      // Popup Content
      const popupDiv = document.createElement('div');
      popupDiv.className = 'p-1 text-xs space-y-1.5 min-w-[200px] text-gray-800';
      popupDiv.innerHTML = `
        <div class="border-b border-gray-200 pb-1">
          <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${bgClass} uppercase mb-1">
            Stop #${visit.sequence} • ${visit.status}
          </span>
          <h4 class="font-bold text-[13px] leading-tight text-gray-900">${visit.customerName}</h4>
          <p class="text-[11px] text-gray-500 flex items-center gap-1">
            <span>📍</span> ${visit.city || 'City'}, ${visit.district || 'District'}
          </p>
        </div>
        <div>
          <p class="text-[11px] text-gray-600"><strong>Purpose:</strong> ${visit.purpose || 'Visit & order review'}</p>
          ${visit.notes ? `<p class="text-[10px] text-gray-500 italic mt-0.5">Notes: ${visit.notes}</p>` : ''}
        </div>
        <div class="pt-1 flex items-center justify-between gap-1 border-t border-gray-200 text-[10px]">
          <a href="https://www.openstreetmap.org/directions?to=${visit.gpsLat},${visit.gpsLng}" target="_blank" rel="noreferrer" class="text-blue-600 font-semibold hover:underline">
            🗺️ Directions
          </a>
        </div>
      `;

      marker.bindPopup(popupDiv);
      marker.on('click', () => {
        if (onSelectVisit) onSelectVisit(visit);
      });

      marker.addTo(layerGroup);
      markers.push(marker);
    });

    // Fit map bounds to show all markers
    try {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.18));
    } catch {
      // ignore
    }
  }, [visits, selectedVisitId, onSelectVisit, onUpdateStatus]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      <div ref={mapContainerRef} className="h-full w-full min-h-[420px]" />

      {/* Floating Map Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap items-center gap-2 rounded-lg border border-line/80 bg-panel/95 px-3 py-1.5 text-[11px] shadow-md backdrop-blur-sm">
        <span className="font-bold text-ink">Route Legend:</span>
        <span className="flex items-center gap-1 font-semibold text-emerald-600">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" /> Completed
        </span>
        <span className="flex items-center gap-1 font-semibold text-amber-500">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> In Progress
        </span>
        <span className="flex items-center gap-1 font-semibold text-blue-600">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-600" /> Upcoming
        </span>
        <span className="flex items-center gap-1 font-semibold text-red-600">
          <span className="h-2.5 w-2.5 rounded-full bg-red-600" /> Missed
        </span>
        <span className="text-muted">• Free OpenStreetMap Tiles</span>
      </div>
    </div>
  );
}
