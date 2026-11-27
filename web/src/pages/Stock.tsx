import { useState } from 'react';
import { Card, PageHeader, Tabs } from '../components/ui/Card';
import StockKpiStrip from '../components/stock/StockKpiStrip';
import StockMaterialList from '../components/stock/StockMaterialList';
import StockUpvc from '../components/stock/StockUpvc';
import StockSyncView from '../components/stock/StockSyncView';
import type { StockView } from '../lib/stockView';
import { serverHost } from '../lib/serverApi';

type MetalSubCategory = 'all' | 'steel-coil' | 'profile-kanda' | 'gp-sheet';

interface MetalSubTab {
  key: MetalSubCategory;
  label: string;
}

const METAL_SUB_TABS: MetalSubTab[] = [
  { key: 'all', label: 'All Metal Stock' },
  { key: 'steel-coil', label: 'Slit Coils' },
  { key: 'profile-kanda', label: 'Profile / Kanda' },
  { key: 'gp-sheet', label: 'GP Sheets' },
];

/** Metal & Steel section: Slit Coils, Profile / Kanda, and GP Sheets extracted from TOTAL STOCK. */
function MetalSteelView({ initialSub = 'all' }: { initialSub?: MetalSubCategory }) {
  const [subCategory, setSubCategory] = useState<MetalSubCategory>(initialSub);

  return (
    <div className="space-y-4">
      {/* Sub-filter pill navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-muted mr-1">Section:</span>
          {METAL_SUB_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubCategory(tab.key)}
              className={`rounded-full px-4 py-1.5 text-xs font-bold transition ${
                subCategory === tab.key
                  ? 'bg-ink text-white shadow-sm'
                  : 'bg-canvas text-muted hover:bg-line/60 hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <StockMaterialList
        key={subCategory}
        categoryKey={subCategory === 'all' ? undefined : subCategory}
        heading={
          subCategory === 'all'
            ? 'Metal & Steel Stock (Sheet: TOTAL STOCK)'
            : subCategory === 'steel-coil'
            ? 'Steel Coil (Slit) Stock'
            : subCategory === 'profile-kanda'
            ? 'Profile / Kanda Stock'
            : 'GP Sheet Stock'
        }
        description={
          subCategory === 'all'
            ? 'All metal materials (slit coils, profile/kanda, and GP sheets) as applied from the verified TOTAL STOCK sheet.'
            : subCategory === 'steel-coil'
            ? 'Slit coils by size and company (JSW, APL, KAMDHENU, TATA, AMNS, etc.).'
            : subCategory === 'profile-kanda'
            ? 'Profile and kanda sections with exact reported weights.'
            : 'Galvanized plain (GP) sheet inventory.'
        }
      />
    </div>
  );
}

const STREAMLINED_TABS = [
  { key: 'steel', label: '🔩 Metal & Steel' },
  { key: 'upvc', label: '🏗️ UPVC Roofing' },
  { key: 'accessories', label: '🧩 Accessories' },
  { key: 'sync', label: '↻ 1-Click Sync & Import' },
];

/** Stock Inventory page: Clean, high-performance UI tailored to DuraSmart’s verified 3-sheet Excel inventory. */
export default function Stock() {
  const [view, setView] = useState<StockView>('steel');

  // Smoothly alias legacy or KPI card navigation keys to the 4 streamlined tabs
  let activeTab: StockView = 'steel';
  let initialMetalSub: MetalSubCategory = 'all';

  if (view === 'steel' || view === 'steel-coil') {
    activeTab = 'steel';
    initialMetalSub = 'steel-coil';
  } else if (view === 'profile' || view === 'profile-kanda') {
    activeTab = 'steel';
    initialMetalSub = 'profile-kanda';
  } else if (view === 'gp' || view === 'gp-sheet') {
    activeTab = 'steel';
    initialMetalSub = 'gp-sheet';
  } else if (view === 'total' || view === 'dashboard') {
    activeTab = 'steel';
    initialMetalSub = 'all';
  } else if (
    view === 'upvc' ||
    view === 'upvc-new' ||
    view === 'upvc-old' ||
    view === 'upvc-waste' ||
    view === 'upvc-total' ||
    view === 'upvc-roofing'
  ) {
    activeTab = 'upvc';
  } else if (view === 'accessories' || view === 'upvc-item') {
    activeTab = 'accessories';
  } else if (view === 'sync') {
    activeTab = 'sync';
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Stock Inventory"
        subtitle={`Live inventory snapshot synchronized from the approved workbook on ${serverHost()}`}
      />

      {/* KPI figure strip at top */}
      <StockKpiStrip onOpen={(target) => setView(target)} />

      {/* 4 Streamlined Navigation Tabs */}
      <Tabs
        tabs={STREAMLINED_TABS}
        active={activeTab}
        onChange={(key) => setView(key as StockView)}
      />

      <Card>
        {activeTab === 'steel' && <MetalSteelView key={initialMetalSub} initialSub={initialMetalSub} />}

        {activeTab === 'upvc' && (
          <StockUpvc
            key="upvc"
            mode={
              view === 'upvc-new'
                ? 'new'
                : view === 'upvc-old'
                ? 'old'
                : view === 'upvc-waste'
                ? 'waste'
                : null
            }
            heading="UPVC Roofing Stock"
            description="Consolidated UPVC Roofing stock: New Standard, Old, and Waste with real-time Color & Length Matrix."
          />
        )}

        {activeTab === 'accessories' && (
          <StockMaterialList
            key="accessories"
            categoryKey="upvc-item"
            heading="UPVC Accessories Stock"
            description="Ridge, Jhallar, Caps, and Hira Ridge synchronized by color and group from the approved accessories sheet."
          />
        )}

        {activeTab === 'sync' && <StockSyncView key="sync" />}
      </Card>
    </div>
  );
}
