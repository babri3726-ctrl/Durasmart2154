import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { ServerVacantDistrict } from '../../lib/serverApi';

interface LeafletVacantAreaMapProps {
  districts: ServerVacantDistrict[];
  selectedDistrict: ServerVacantDistrict | null;
  onSelectDistrict: (district: ServerVacantDistrict) => void;
  onAssignDistrict: (district: ServerVacantDistrict) => void;
}

export default function LeafletVacantAreaMap({
  districts,
  selectedDistrict,
  onSelectDistrict,
  onAssignDistrict,
}: LeafletVacantAreaMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [30.2, 75.8],
        zoom: 7,
        zoomControl: true,
      });

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

  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    const markers: L.CircleMarker[] = [];

    districts.forEach((dist) => {
      const isSelected = selectedDistrict?.district === dist.district;

      let color = '#22c55e'; // Green: assigned
      let fillColor = '#4ade80';
      if (dist.status === 'vacant') {
        color = '#ef4444'; // Red: vacant
        fillColor = '#f87171';
      } else if (dist.status === 'partial') {
        color = '#f59e0b'; // Amber: partial
        fillColor = '#fbbf24';
      }

      const circle = L.circleMarker([dist.lat, dist.lng], {
        radius: isSelected ? 16 : Math.max(9, Math.min(22, 8 + dist.totalShops * 1.2)),
        color: color,
        weight: isSelected ? 3.5 : 2,
        fillColor: fillColor,
        fillOpacity: isSelected ? 0.85 : 0.65,
      });

      const popupContent = `
        <div style="font-family: inherit; font-size: 12px; min-width: 180px; padding: 2px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; margin-bottom: 6px;">
            <strong style="font-size: 13px; color: #111827;">${dist.district}</strong>
            <span style="font-size: 10px; font-weight: bold; text-transform: uppercase; color: ${color};">
              ${dist.status}
            </span>
          </div>
          <p style="margin: 2px 0; color: #4b5563;">State: <strong>${dist.state}</strong></p>
          <p style="margin: 2px 0; color: #4b5563;">Total Dealer Shops: <strong>${dist.totalShops}</strong></p>
          <p style="margin: 2px 0; color: #4b5563;">Assigned Officer: <strong>${dist.assignedSalesperson || 'None (Vacant)'}</strong></p>
          ${
            dist.cities && dist.cities.length > 0
              ? `<p style="margin: 3px 0 0 0; font-size: 10px; color: #6b7280;">Cities: ${dist.cities.slice(0, 3).join(', ')}${dist.cities.length > 3 ? '…' : ''}</p>`
              : ''
          }
        </div>
      `;

      circle.bindPopup(popupContent);
      circle.on('click', () => {
        onSelectDistrict(dist);
      });

      circle.addTo(layerGroup);
      markers.push(circle);
    });

    if (selectedDistrict && map) {
      map.setView([selectedDistrict.lat, selectedDistrict.lng], 9);
    }
  }, [districts, selectedDistrict, onSelectDistrict, onAssignDistrict]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      <div ref={mapContainerRef} className="h-full w-full min-h-[460px]" />

      {/* Floating Legend */}
      <div className="absolute bottom-3 left-3 z-[1000] flex flex-wrap items-center gap-2 rounded-lg border border-line/80 bg-panel/95 px-3 py-1.5 text-[11px] shadow-md backdrop-blur-sm">
        <span className="font-bold text-ink">Territory Status:</span>
        <span className="flex items-center gap-1 font-semibold text-emerald-600">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Covered District
        </span>
        <span className="flex items-center gap-1 font-semibold text-amber-500">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Partially Covered
        </span>
        <span className="flex items-center gap-1 font-semibold text-red-600">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Vacant (Unserved Area)
        </span>
        <span className="text-muted">• OpenStreetMap Live</span>
      </div>
    </div>
  );
}
