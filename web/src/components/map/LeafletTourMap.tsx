import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Search } from 'lucide-react';
import { ServerTourVisit, ServerCustomer } from '../../lib/serverApi';
import { getCoordinates } from '../../lib/geoCoordinates';

interface LeafletTourMapProps {
  visits: ServerTourVisit[];
  selectedVisitId?: string | null;
  allCustomers?: ServerCustomer[];
  onSelectVisit?: (visit: ServerTourVisit) => void;
  onUpdateStatus?: (visitId: string, status: 'planned' | 'in_progress' | 'completed' | 'missed') => void;
  onAddShopToBeat?: (cust: ServerCustomer) => void;
}

export default function LeafletTourMap({
  visits,
  selectedVisitId,
  allCustomers = [],
  onSelectVisit,
  onUpdateStatus,
  onAddShopToBeat,
}: LeafletTourMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayerGroupRef = useRef<L.LayerGroup | null>(null);
  const dealerLayerGroupRef = useRef<L.LayerGroup | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ServerCustomer[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Initialize Leaflet Map with OpenStreetMap Standard (Free, No API Key, No Billing)
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [30.2, 75.8],
        zoom: 8,
        zoomControl: true,
      });

      // Free OpenStreetMap Standard Tile Layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      dealerLayerGroupRef.current = L.layerGroup().addTo(map);
      routeLayerGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        routeLayerGroupRef.current = null;
        dealerLayerGroupRef.current = null;
      }
    };
  }, []);

  // Update Route Markers & Polylines whenever visits change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const layerGroup = routeLayerGroupRef.current;
    if (!map || !layerGroup) return;

    layerGroup.clearLayers();

    // Ensure valid coordinates
    const validVisits = visits.map((v) => {
      let lat = v.gpsLat;
      let lng = v.gpsLng;
      if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) {
        const coords = getCoordinates(v.city, v.district);
        lat = coords[0];
        lng = coords[1];
      }
      return { ...v, gpsLat: lat, gpsLng: lng };
    });

    if (validVisits.length === 0) {
      return;
    }

    // Sort by sequence for route polyline
    const sortedVisits = [...validVisits].sort((a, b) => a.sequence - b.sequence);
    const latLngs: L.LatLngExpression[] = sortedVisits.map((v) => [v.gpsLat!, v.gpsLng!]);

    if (latLngs.length > 1) {
      const polyline = L.polyline(latLngs, {
        color: '#2563eb',
        weight: 4,
        opacity: 0.9,
        dashArray: '6, 8',
      });
      polyline.addTo(layerGroup);
    }

    const markers: L.Marker[] = [];

    sortedVisits.forEach((visit) => {
      const isSelected = visit.id === selectedVisitId;

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
        borderClass = 'border-amber-300 ring-4 ring-blue-500/40 scale-125';
      }

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

      const gmapsQuery = encodeURIComponent(`${visit.customerName} ${visit.city || ''}`);
      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${gmapsQuery}`;

      const popupDiv = document.createElement('div');
      popupDiv.className = 'p-1 text-xs space-y-1.5 min-w-[210px] text-gray-800';
      popupDiv.innerHTML = `
        <div class="border-b border-gray-200 pb-1">
          <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${bgClass} uppercase mb-1">
            Stop #${visit.sequence} • ${visit.status}
          </span>
          <h4 class="font-bold text-[13px] leading-tight text-gray-900">${visit.customerName}</h4>
          <p class="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
            <span>📍</span> ${visit.city || 'City'}, ${visit.district || 'District'}
          </p>
        </div>
        <div>
          <p class="text-[11px] text-gray-600"><strong>Purpose:</strong> ${visit.purpose || 'Visit & order review'}</p>
          ${visit.notes ? `<p class="text-[10px] text-gray-500 italic mt-0.5">Notes: ${visit.notes}</p>` : ''}
        </div>
        <div class="pt-1.5 flex items-center justify-between gap-2 border-t border-gray-200 text-[11px]">
          <a href="${gmapsUrl}" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-blue-600 font-bold hover:underline">
            <span>🗺️ Google Maps</span>
          </a>
          <a href="https://www.openstreetmap.org/directions?to=${visit.gpsLat},${visit.gpsLng}" target="_blank" rel="noreferrer" class="text-gray-500 hover:text-gray-800">
            Route (OSM)
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

    if (markers.length > 0) {
      try {
        const group = L.featureGroup(markers);
        map.fitBounds(group.getBounds().pad(0.2));
      } catch {
        // ignore
      }
    }
  }, [visits, selectedVisitId, onSelectVisit, onUpdateStatus]);

  // Handle Search Input
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (!val.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const q = val.toLowerCase().trim();
    const matches = allCustomers
      .filter((c) => c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.district.toLowerCase().includes(q))
      .slice(0, 8);
    setSearchResults(matches);
    setShowResults(true);
  };

  // Fly to selected shop on map
  const handleSelectShop = (cust: ServerCustomer) => {
    setShowResults(false);
    setSearchQuery(cust.name);
    const map = mapInstanceRef.current;
    if (!map) return;

    const coords = getCoordinates(cust.city, cust.district);
    map.flyTo(coords, 14, { duration: 1.2 });

    const gmapsQuery = encodeURIComponent(`${cust.name} ${cust.city}`);
    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${gmapsQuery}`;

    // Show temporary search pin with Google Maps button
    const popupContent = `
      <div class="p-1 text-xs space-y-1.5 min-w-[210px] text-gray-800">
        <div class="border-b border-gray-200 pb-1">
          <span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-white uppercase mb-1">
            Dealer Shop Located
          </span>
          <h4 class="font-bold text-[13px] leading-tight text-gray-900">${cust.name}</h4>
          <p class="text-[11px] text-gray-500 flex items-center gap-1 mt-0.5">
            <span>📍</span> ${cust.city}, ${cust.district}
          </p>
          <p class="text-[11px] text-emerald-700 font-semibold mt-0.5">
            Balance: ₹${(cust.balance || 0).toLocaleString('en-IN')} • ${cust.salesperson || 'Unassigned'}
          </p>
        </div>
        <div class="pt-1.5 flex items-center justify-between gap-2 border-t border-gray-200 text-[11px]">
          <a href="${gmapsUrl}" target="_blank" rel="noreferrer" class="inline-flex items-center gap-1 text-blue-600 font-bold hover:underline">
            <span>🗺️ Google Maps</span>
          </a>
        </div>
      </div>
    `;

    L.popup()
      .setLatLng(coords)
      .setContent(popupContent)
      .openOn(map);
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-line bg-panel shadow-sm">
      {/* Search Header Bar (Google Maps style) */}
      <div className="absolute top-3 left-3 right-16 z-[1000] max-w-md">
        <div className="relative shadow-md rounded-lg">
          <div className="flex items-center rounded-lg border border-line bg-surface/95 px-3 py-2 text-xs shadow backdrop-blur-sm">
            <Search size={15} className="mr-2 text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search shop (e.g. Satnam Traders, Kalra Steel) or city..."
              className="w-full bg-transparent font-medium text-ink outline-none placeholder:text-muted"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setShowResults(false);
                }}
                className="ml-1 text-xs text-muted hover:text-ink"
              >
                ✕
              </button>
            )}
          </div>

          {/* Autocomplete Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg z-50">
              {searchResults.map((cust) => (
                <div
                  key={cust.id}
                  onClick={() => handleSelectShop(cust)}
                  className="flex items-center justify-between px-3 py-2 text-xs hover:bg-canvas cursor-pointer border-b border-line/40 last:border-0"
                >
                  <div>
                    <p className="font-bold text-ink">{cust.name}</p>
                    <p className="text-[10px] text-muted">
                      📍 {cust.city}, {cust.district} • {cust.salesperson || 'Unassigned'}
                    </p>
                  </div>
                  {onAddShopToBeat && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddShopToBeat(cust);
                        setShowResults(false);
                      }}
                      className="rounded bg-brand-blue/10 px-2 py-0.5 text-[10px] font-bold text-brand-blue hover:bg-brand-blue hover:text-white"
                      title="Add to today's beat"
                    >
                      + Add Stop
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div ref={mapContainerRef} className="h-full w-full min-h-[460px]" />

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
