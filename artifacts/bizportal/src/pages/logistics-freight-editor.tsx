import { AppShell } from "@/components/layout/AppShell";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GooglePlacesAutocomplete } from "@/components/ui/google-places-autocomplete";
import { RouteMapPreview } from "@/components/ui/route-map-preview";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Loader2, ScanLine, ChevronsUpDown, Check, Plus, Pencil, X, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { useVendors } from "@/hooks/useVendors";
import { FreightScanDialog, type FreightFormFields } from "@/components/freight/FreightScanDialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useCreateFreightShipment,
  useGetFreightShipment,
  useUpdateFreightShipment,
  useListSalesDocuments,
  useListPurchaseDocuments,
  useCreateSupplier,
  useUpdateSupplier,
  getListFreightShipmentsQueryKey,
  getGetFreightShipmentQueryKey,
  getListSalesDocumentsQueryKey,
  getListPurchaseDocumentsQueryKey,
  type Supplier,
} from "@workspace/api-client-react";

type AutofillSource = "po" | "so" | "vendor" | "catalog";

const AUTOFILL_SOURCE_META: Record<AutofillSource, { label: string; icon: string; iconBg: string; iconText: string; iconHover: string }> = {
  po:      { label: "Purchase Order",                       icon: "PO", iconBg: "bg-blue-100",   iconText: "text-blue-700",   iconHover: "hover:bg-blue-200" },
  so:      { label: "Sales Order",                          icon: "SO", iconBg: "bg-blue-100",   iconText: "text-blue-700",   iconHover: "hover:bg-blue-200" },
  vendor:  { label: "Vendor (dipilih dari katalog)",        icon: "V",  iconBg: "bg-purple-100", iconText: "text-purple-700", iconHover: "hover:bg-purple-200" },
  catalog: { label: "Vendor (cadangan dari katalog)",       icon: "K",  iconBg: "bg-amber-100",  iconText: "text-amber-700",  iconHover: "hover:bg-amber-200" },
};

function AutofillRestoreMarker({ source, fieldKey, originalValue, currentValue, onRestore }: {
  source: AutofillSource;
  fieldKey: string;
  originalValue: string;
  currentValue: string;
  onRestore: () => void;
}) {
  const meta = AUTOFILL_SOURCE_META[source];
  const isDifferent = originalValue !== currentValue;
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stickyRef = useRef(false);
  const cancelTimers = () => {
    if (openTimerRef.current) { clearTimeout(openTimerRef.current); openTimerRef.current = null; }
    if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
  };
  const scheduleHoverOpen = () => {
    cancelTimers();
    openTimerRef.current = setTimeout(() => setOpen(true), 150);
  };
  const scheduleHoverClose = () => {
    if (stickyRef.current) return;
    cancelTimers();
    closeTimerRef.current = setTimeout(() => setOpen(false), 200);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        cancelTimers();
        if (o) { stickyRef.current = true; }
        else { stickyRef.current = false; }
        setOpen(o);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex items-center justify-center h-5 min-w-[20px] px-1 rounded text-[10px] font-bold ${meta.iconBg} ${meta.iconText} ${meta.iconHover} transition-colors`}
          aria-label={`Lihat nilai asli dari ${meta.label}`}
          data-testid={`autofill-marker-${fieldKey}-${source}`}
          onMouseEnter={scheduleHoverOpen}
          onMouseLeave={scheduleHoverClose}
          onClick={() => { stickyRef.current = true; }}
        >
          {meta.icon}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 p-3 text-xs space-y-2"
        onMouseEnter={cancelTimers}
        onMouseLeave={scheduleHoverClose}
      >
        <div className="font-semibold">Diisi otomatis dari {meta.label}</div>
        <div>
          <div className="text-muted-foreground mb-0.5">Nilai asli:</div>
          <div className="break-words font-medium">"{originalValue || "(kosong)"}"</div>
        </div>
        {isDifferent ? (
          <button
            type="button"
            onClick={() => { stickyRef.current = false; onRestore(); setOpen(false); }}
            className={`w-full inline-flex items-center justify-center rounded px-2 py-1 text-xs font-medium ${meta.iconBg} ${meta.iconText} ${meta.iconHover} transition-colors`}
            data-testid={`autofill-restore-${fieldKey}-${source}`}
          >
            Pulihkan nilai asli
          </button>
        ) : (
          <div className="italic text-muted-foreground">Nilai sekarang sama dengan nilai asli.</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export default function LogisticsFreightEditorPage() {
  const params = useParams<{ id?: string }>();
  const isEdit = Boolean(params.id);
  const id = params.id ? Number(params.id) : undefined;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();

  const { data: existing, isLoading: loadingExisting } = useGetFreightShipment(id ?? 0, {
    query: { enabled: isEdit, queryKey: getGetFreightShipmentQueryKey(id ?? 0) },
  });

  const create = useCreateFreightShipment();
  const update = useUpdateFreightShipment();
  const createSupplier = useCreateSupplier();
  const updateSupplier = useUpdateSupplier();

  const { data: _salesOrdersPaginated } = useListSalesDocuments({ kind: "order", limit: 500 }, { query: { queryKey: getListSalesDocumentsQueryKey({ kind: "order" }) } });
  const salesOrders = useMemo(() => _salesOrdersPaginated?.data ?? [], [_salesOrdersPaginated]);
  const { data: purchaseOrders = [] } = useListPurchaseDocuments({ kind: "order" }, { query: { queryKey: getListPurchaseDocumentsQueryKey({ kind: "order" }) } });
  const { data: suppliers = [], isFetched: suppliersFetched } = useVendors();
  const [soPickerOpen, setSoPickerOpen] = useState(false);
  const [poPickerOpen, setPoPickerOpen] = useState(false);
  const [vendorPickerOpen, setVendorPickerOpen] = useState(false);
  const [vendorSearchQuery, setVendorSearchQuery] = useState("");
  const [addVendorDialogOpen, setAddVendorDialogOpen] = useState(false);
  const [newVendorForm, setNewVendorForm] = useState({ name: "", country: "", address: "" });
  const [editVendorDialogOpen, setEditVendorDialogOpen] = useState(false);
  const [editVendorForm, setEditVendorForm] = useState({ name: "", country: "", address: "" });
  const [salesDocId, setSalesDocId] = useState<number | null>(null);
  const [purchaseDocId, setPurchaseDocId] = useState<number | null>(null);
  const [shipperNameAutoFilled, setShipperNameAutoFilled] = useState(false);
  const [shipperNameAutoFilledValue, setShipperNameAutoFilledValue] = useState("");
  const [shipperAddressAutoFilled, setShipperAddressAutoFilled] = useState(false);
  const [shipperAddressAutoFilledValue, setShipperAddressAutoFilledValue] = useState("");
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [vendorWasManuallySelected, setVendorWasManuallySelected] = useState(false);
  const [prePOVendorId, setPrePOVendorId] = useState<number | null>(null);
  const [shipperVendorNameFilled, setShipperVendorNameFilled] = useState(false);
  const [shipperVendorAddressFilled, setShipperVendorAddressFilled] = useState(false);
  const [shipperVendorNameValue, setShipperVendorNameValue] = useState("");
  const [shipperVendorAddressValue, setShipperVendorAddressValue] = useState("");
  const [shipperCatalogAddressFilled, setShipperCatalogAddressFilled] = useState(false);
  const [shipperCatalogAddressValue, setShipperCatalogAddressValue] = useState("");
  const [consigneeNameAutoFilled, setConsigneeNameAutoFilled] = useState(false);
  const [consigneeNameAutoFilledValue, setConsigneeNameAutoFilledValue] = useState("");
  const [consigneeAddressAutoFilled, setConsigneeAddressAutoFilled] = useState(false);
  const [consigneeAddressAutoFilledValue, setConsigneeAddressAutoFilledValue] = useState("");
  const [originAutoFilled, setOriginAutoFilled] = useState(false);
  const [originAutoFilledValue, setOriginAutoFilledValue] = useState("");
  const [destinationAutoFilled, setDestinationAutoFilled] = useState(false);
  const [destinationAutoFilledValue, setDestinationAutoFilledValue] = useState("");
  const [transportModeAutoFilled, setTransportModeAutoFilled] = useState(false);
  const [transportModeAutoFilledValue, setTransportModeAutoFilledValue] = useState("");
  const [form, setForm] = useState({
    shipperName: "",
    shipperAddress: "",
    consigneeName: "",
    consigneeAddress: "",
    notifyParty: "",
    commodity: "",
    hsCode: "",
    grossWeight: "",
    netWeight: "",
    quantity: "",
    packingType: "",
    dimensions: "",
    marksAndNumbers: "",
    measurement: "",
    origin: "",
    destination: "",
    portOfLoading: "",
    portOfDischarge: "",
    vessel: "",
    voyage: "",
    notes: "",
    transportMode: "",
    cargoType: "",
    containerNo: "",
    freightCost: "",
  });

  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [ratePerKm, setRatePerKm] = useState("");
  const handleDistanceFetched = useCallback((km: number | null) => {
    setRouteDistanceKm(km);
  }, []);

  useEffect(() => {
    if (!isEdit) {
      const sp = new URLSearchParams(window.location.search);
      const sid = sp.get("salesDocId");
      if (sid) setSalesDocId(Number(sid));
      const pid = sp.get("purchaseDocId");
      if (pid) setPurchaseDocId(Number(pid));
      setForm((f) => ({
        ...f,
        origin: sp.get("origin") ?? f.origin,
        destination: sp.get("destination") ?? f.destination,
        consigneeName: sp.get("consigneeName") ?? f.consigneeName,
        transportMode: sp.get("transportMode") ?? f.transportMode,
      }));
    }
  }, [isEdit]);

  useEffect(() => {
    if (existing) {
      if ((existing as any).salesDocId) setSalesDocId((existing as any).salesDocId);
      if ((existing as any).purchaseDocId != null) setPurchaseDocId((existing as any).purchaseDocId);
      setForm({
        shipperName: existing.shipperName ?? "",
        shipperAddress: existing.shipperAddress ?? "",
        consigneeName: existing.consigneeName ?? "",
        consigneeAddress: existing.consigneeAddress ?? "",
        notifyParty: existing.notifyParty ?? "",
        commodity: existing.commodity ?? "",
        hsCode: existing.hsCode ?? "",
        grossWeight: existing.grossWeight ?? "",
        netWeight: existing.netWeight ?? "",
        quantity: existing.quantity != null ? String(existing.quantity) : "",
        packingType: existing.packingType ?? "",
        dimensions: existing.dimensions ?? "",
        marksAndNumbers: existing.marksAndNumbers ?? "",
        measurement: existing.measurement ?? "",
        origin: existing.origin ?? "",
        destination: existing.destination ?? "",
        portOfLoading: existing.portOfLoading ?? "",
        portOfDischarge: existing.portOfDischarge ?? "",
        vessel: existing.vessel ?? "",
        voyage: existing.voyage ?? "",
        notes: existing.notes ?? "",
        transportMode: (existing as any).transportMode ?? "",
        cargoType: (existing as any).cargoType ?? "",
        containerNo: (existing as any).containerNo ?? "",
        freightCost: (existing as any).freightCost ? String((existing as any).freightCost) : "",
      });
    }
  }, [existing]);

  const autoFillSetupDone = useRef(false);
  const poUrlPreLinkDone = useRef(false);
  const vendorRestoreDone = useRef(false);
  const [scannedFields, setScannedFields] = useState<Set<string>>(new Set());
  const [dismissedBadges, setDismissedBadges] = useState<Set<string>>(new Set());
  const dismissBadge = (key: string) => setDismissedBadges((prev) => { const next = new Set(prev); next.add(key); return next; });
  const dismissScannedField = (key: string) => setScannedFields((prev) => { const next = new Set(prev); next.delete(key); return next; });
  const clearDismissedBadges = (...keys: string[]) => setDismissedBadges((prev) => { const next = new Set(prev); keys.forEach((k) => next.delete(k)); return next; });

  useEffect(() => {
    autoFillSetupDone.current = false;
    poUrlPreLinkDone.current = false;
    vendorRestoreDone.current = false;
    setPrePOVendorId(null);
    setScannedFields(new Set());
    setDismissedBadges(new Set());
    setShipperNameAutoFilled(false);
    setShipperAddressAutoFilled(false);
    setConsigneeNameAutoFilled(false);
    setConsigneeAddressAutoFilled(false);
    setOriginAutoFilled(false);
    setDestinationAutoFilled(false);
    setTransportModeAutoFilled(false);
    setShipperVendorNameFilled(false);
    setShipperVendorAddressFilled(false);
    setShipperCatalogAddressFilled(false);
    setShipperNameAutoFilledValue("");
    setShipperAddressAutoFilledValue("");
    setConsigneeNameAutoFilledValue("");
    setConsigneeAddressAutoFilledValue("");
    setOriginAutoFilledValue("");
    setDestinationAutoFilledValue("");
    setTransportModeAutoFilledValue("");
    setShipperVendorNameValue("");
    setShipperVendorAddressValue("");
    setShipperCatalogAddressValue("");
  }, [id]);

  // Catalog-aware PO autofill helper (shared by manual selection, URL pre-link, and edit load)
  const applyPoAutoFill = useCallback((poDoc: { supplierName?: string | null; supplierAddress?: string | null }) => {
    const normalise = (s: string) => s.trim().toLowerCase();
    // Find a catalog vendor that matches the PO's supplier name
    const catalogVendor = poDoc.supplierName
      ? suppliers.find((s) => normalise(s.name) === normalise(poDoc.supplierName ?? ""))
      : null;

    if (poDoc.supplierName && !form.shipperName) {
      setShipperNameAutoFilled(true);
      setShipperNameAutoFilledValue(poDoc.supplierName);
      clearDismissedBadges("shipperName:po");
    }
    if (!form.shipperAddress) {
      if (poDoc.supplierAddress) {
        setShipperAddressAutoFilled(true);
        setShipperAddressAutoFilledValue(poDoc.supplierAddress);
        setShipperCatalogAddressFilled(false);
        setShipperCatalogAddressValue("");
        clearDismissedBadges("shipperAddress:po");
      } else if (catalogVendor?.address) {
        setShipperCatalogAddressFilled(true);
        setShipperCatalogAddressValue(catalogVendor.address);
        setShipperAddressAutoFilled(false);
        setShipperAddressAutoFilledValue("");
        clearDismissedBadges("shipperAddress:catalog");
      }
    }
    // Pre-select the matching catalog vendor so "Edit Vendor" button appears.
    // Always update (including clearing to null) so switching POs doesn't leave
    // a stale vendor ID that could cause editing the wrong vendor.
    setSelectedVendorId(catalogVendor ? catalogVendor.id : null);
    setVendorWasManuallySelected(false);
    setForm((f) => {
      return {
        ...f,
        shipperName: f.shipperName || (poDoc.supplierName ?? ""),
        shipperAddress: f.shipperAddress || (poDoc.supplierAddress ?? "") || (catalogVendor?.address ?? ""),
      };
    });
  }, [form.shipperAddress, form.shipperName, suppliers]);

  // Create mode: auto-fill shipper info when a PO is pre-linked via URL param
  useEffect(() => {
    if (isEdit || !purchaseDocId || purchaseOrders.length === 0 || !suppliersFetched || poUrlPreLinkDone.current) return;
    // Only apply when purchaseDocId came from URL (not from manual selection via handleSelectPo)
    const sp = new URLSearchParams(window.location.search);
    if (!sp.get("purchaseDocId")) return;
    const poDoc = purchaseOrders.find((d) => d.id === purchaseDocId);
    if (!poDoc) return;
    poUrlPreLinkDone.current = true;
    applyPoAutoFill(poDoc);
  }, [applyPoAutoFill, isEdit, purchaseDocId, purchaseOrders, suppliersFetched]);

  useEffect(() => {
    if (!isEdit || !existing || autoFillSetupDone.current) return;
    const existingSalesDocId = (existing as any).salesDocId;
    const existingPurchaseDocId = (existing as any).purchaseDocId;
    // Track each required source independently — only finalize when ALL required docs are resolved
    let soProcessed = !existingSalesDocId;
    let poProcessed = !existingPurchaseDocId;
    if (existingSalesDocId && salesOrders.length > 0) {
      const soDoc = salesOrders.find((d) => d.id === existingSalesDocId);
      if (soDoc) {
        if (soDoc.customerName) { setConsigneeNameAutoFilled(true); setConsigneeNameAutoFilledValue(soDoc.customerName); }
        if (soDoc.customerAddress) { setConsigneeAddressAutoFilled(true); setConsigneeAddressAutoFilledValue(soDoc.customerAddress); }
        if ((soDoc as any).origin) { setOriginAutoFilled(true); setOriginAutoFilledValue((soDoc as any).origin); clearDismissedBadges("origin:so"); }
        if ((soDoc as any).destination) { setDestinationAutoFilled(true); setDestinationAutoFilledValue((soDoc as any).destination); clearDismissedBadges("destination:so"); }
        if ((soDoc as any).transportMode) { setTransportModeAutoFilled(true); setTransportModeAutoFilledValue((soDoc as any).transportMode); clearDismissedBadges("transportMode:so"); }
        soProcessed = true;
      }
    }
    if (existingPurchaseDocId && purchaseOrders.length > 0 && suppliersFetched) {
      const poDoc = purchaseOrders.find((d) => d.id === existingPurchaseDocId);
      if (poDoc) {
        applyPoAutoFill(poDoc);
        poProcessed = true;
      }
    }
    // Mark setup complete only when all linked sources are resolved
    if (soProcessed && poProcessed) autoFillSetupDone.current = true;
  }, [applyPoAutoFill, isEdit, existing, salesOrders, purchaseOrders, suppliersFetched]);

  // On edit load: if no PO is linked but shipperName matches a catalog vendor, pre-select that vendor
  // and mark it as manually-chosen so unlinking a PO later won't clear it.
  useEffect(() => {
    if (!isEdit || !existing || !suppliersFetched || vendorRestoreDone.current) return;
    const existingPurchaseDocId = (existing as any).purchaseDocId;
    if (existingPurchaseDocId) return; // PO present → applyPoAutoFill will handle vendor selection
    vendorRestoreDone.current = true;
    if (!existing.shipperName) return;
    const normalise = (s: string) => s.trim().toLowerCase();
    const matchedVendor = suppliers.find((s) => normalise(s.name) === normalise(existing.shipperName ?? ""));
    if (matchedVendor) {
      setSelectedVendorId(matchedVendor.id);
      setVendorWasManuallySelected(true);
    }
  }, [isEdit, existing, suppliersFetched, suppliers]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setScannedFields((prev) => { const next = new Set(prev); next.delete(k); return next; });
  };

  const handleSelectSo = (docId: number) => {
    const doc = salesOrders.find((d) => d.id === docId);
    setSalesDocId(docId);
    setSoPickerOpen(false);
    if (doc) {
      setForm((f) => {
        const willFillConsignee = !f.consigneeName && !!doc.customerName;
        const willFillConsigneeAddress = !f.consigneeAddress && !!(doc.customerAddress ?? "");
        const willFillOrigin = !f.origin && !!(doc.origin ?? "");
        const willFillDestination = !f.destination && !!(doc.destination ?? "");
        const willFillTransportMode = !f.transportMode && !!(doc.transportMode ?? "");
        if (willFillConsignee) { setConsigneeNameAutoFilled(true); setConsigneeNameAutoFilledValue(doc.customerName || ""); setScannedFields((prev) => { const next = new Set(prev); next.delete("consigneeName"); return next; }); clearDismissedBadges("consigneeName:so"); }
        if (willFillConsigneeAddress) { setConsigneeAddressAutoFilled(true); setConsigneeAddressAutoFilledValue(doc.customerAddress ?? ""); setScannedFields((prev) => { const next = new Set(prev); next.delete("consigneeAddress"); return next; }); clearDismissedBadges("consigneeAddress:so"); }
        if (willFillOrigin) { setOriginAutoFilled(true); setOriginAutoFilledValue(doc.origin ?? ""); setScannedFields((prev) => { const next = new Set(prev); next.delete("origin"); return next; }); clearDismissedBadges("origin:so"); }
        if (willFillDestination) { setDestinationAutoFilled(true); setDestinationAutoFilledValue(doc.destination ?? ""); setScannedFields((prev) => { const next = new Set(prev); next.delete("destination"); return next; }); clearDismissedBadges("destination:so"); }
        if (willFillTransportMode) { setTransportModeAutoFilled(true); setTransportModeAutoFilledValue(doc.transportMode ?? ""); setScannedFields((prev) => { const next = new Set(prev); next.delete("transportMode"); return next; }); clearDismissedBadges("transportMode:so"); }
        return {
          ...f,
          consigneeName: doc.customerName || f.consigneeName,
          consigneeAddress: f.consigneeAddress || (doc.customerAddress ?? ""),
          origin: (doc.origin ?? "") || f.origin,
          destination: (doc.destination ?? "") || f.destination,
          transportMode: (doc.transportMode ?? "") || f.transportMode,
        };
      });
    }
  };

  const clearPOLink = (openPicker = false) => {
    if (shipperNameAutoFilled) {
      setForm((f) => ({ ...f, shipperName: f.shipperName === shipperNameAutoFilledValue ? "" : f.shipperName }));
      setShipperNameAutoFilled(false);
    }
    if (shipperAddressAutoFilled) {
      setForm((f) => ({ ...f, shipperAddress: f.shipperAddress === shipperAddressAutoFilledValue ? "" : f.shipperAddress }));
      setShipperAddressAutoFilled(false);
    }
    if (shipperCatalogAddressFilled) {
      setForm((f) => ({ ...f, shipperAddress: f.shipperAddress === shipperCatalogAddressValue ? "" : f.shipperAddress }));
      setShipperCatalogAddressFilled(false);
      setShipperCatalogAddressValue("");
    }
    if (prePOVendorId !== null) {
      setSelectedVendorId(prePOVendorId);
      setVendorWasManuallySelected(true);
    } else if (!vendorWasManuallySelected) {
      setSelectedVendorId(null);
    }
    setPrePOVendorId(null);
    setPurchaseDocId(null);
    if (openPicker) setPoPickerOpen(true);
  };

  const handleSelectPo = (docId: number) => {
    const doc = purchaseOrders.find((d) => d.id === docId);
    setPurchaseDocId(docId);
    setPoPickerOpen(false);
    if (doc) {
      setPrePOVendorId(selectedVendorId);
      setSelectedVendorId(null);
      applyPoAutoFill(doc);
      setScannedFields((prev) => {
        const next = new Set(prev);
        next.delete("shipperName");
        next.delete("shipperAddress");
        return next;
      });
    }
  };

  const handleSelectVendor = (supplierId: number) => {
    const vendor = suppliers.find((s) => s.id === supplierId);
    setVendorPickerOpen(false);
    if (!vendor) return;
    setSelectedVendorId(supplierId);
    setVendorWasManuallySelected(true);
    setPrePOVendorId(null);
    setShipperVendorNameValue(vendor.name);
    setShipperVendorAddressValue(vendor.address ?? "");
    setForm((f) => {
      const willFillName = !f.shipperName && !!vendor.name;
      const willFillAddress = !f.shipperAddress && !!vendor.address;
      if (willFillName) {
        setShipperVendorNameFilled(true);
        setShipperNameAutoFilled(false);
        setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperName"); return next; });
        clearDismissedBadges("shipperName:vendor");
      }
      if (willFillAddress) {
        setShipperVendorAddressFilled(true);
        setShipperAddressAutoFilled(false);
        setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperAddress"); return next; });
        clearDismissedBadges("shipperAddress:vendor");
      }
      return {
        ...f,
        shipperName: f.shipperName || vendor.name,
        shipperAddress: f.shipperAddress || (vendor.address ?? ""),
      };
    });
  };

  const handleOpenAddVendorDialog = (prefillName: string) => {
    setNewVendorForm({ name: prefillName, country: "", address: "" });
    setVendorPickerOpen(false);
    setAddVendorDialogOpen(true);
  };

  const handleOpenEditVendorDialog = () => {
    const vendor = suppliers.find((s) => s.id === selectedVendorId);
    if (!vendor) return;
    setEditVendorForm({ name: vendor.name, country: vendor.country ?? "", address: vendor.address ?? "" });
    setEditVendorDialogOpen(true);
  };

  const handleSaveEditVendor = () => {
    if (!editVendorForm.name || !editVendorForm.country) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    if (!selectedVendorId) return;
    updateSupplier.mutate(
      { id: selectedVendorId, data: { name: editVendorForm.name, country: editVendorForm.country, contactEmail: "", address: editVendorForm.address || undefined } },
      {
        onSuccess: (updated) => {
          queryClient.invalidateQueries({ queryKey: ["vendors-filtered"] });
          setEditVendorDialogOpen(false);
          setShipperVendorNameValue(updated.name);
          setShipperVendorAddressValue(updated.address ?? "");
          setForm((f) => ({
            ...f,
            shipperName: shipperVendorNameFilled ? updated.name : f.shipperName,
            shipperAddress: shipperVendorAddressFilled ? (updated.address ?? "") : f.shipperAddress,
          }));
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const handleSaveNewVendor = () => {
    if (!newVendorForm.name || !newVendorForm.country) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    createSupplier.mutate(
      { data: { name: newVendorForm.name, country: newVendorForm.country, contactEmail: "", address: newVendorForm.address || undefined } },
      {
        onSuccess: (newSupplier) => {
          queryClient.invalidateQueries({ queryKey: ["vendors-filtered"] });
          setAddVendorDialogOpen(false);
          setVendorSearchQuery("");
          handleSelectVendorByData(newSupplier);
          toast({ title: t.common.success });
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
      }
    );
  };

  const handleSelectVendorByData = (vendor: { id: number; name: string; address?: string | null }) => {
    setSelectedVendorId(vendor.id);
    setVendorWasManuallySelected(true);
    setPrePOVendorId(null);
    setShipperVendorNameValue(vendor.name);
    setShipperVendorAddressValue(vendor.address ?? "");
    setForm((f) => {
      const willFillName = !f.shipperName && !!vendor.name;
      const willFillAddress = !f.shipperAddress && !!vendor.address;
      if (willFillName) {
        setShipperVendorNameFilled(true);
        setShipperNameAutoFilled(false);
        setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperName"); return next; });
        clearDismissedBadges("shipperName:vendor");
      }
      if (willFillAddress) {
        setShipperVendorAddressFilled(true);
        setShipperAddressAutoFilled(false);
        setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperAddress"); return next; });
        clearDismissedBadges("shipperAddress:vendor");
      }
      return {
        ...f,
        shipperName: f.shipperName || vendor.name,
        shipperAddress: f.shipperAddress || (vendor.address ?? ""),
      };
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEdit && !salesDocId) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    if (!form.shipperName || !form.consigneeName || !form.commodity || !form.origin || !form.destination) {
      toast({ title: t.common.error, variant: "destructive" });
      return;
    }
    const payload = {
      shipperName: form.shipperName,
      shipperAddress: form.shipperAddress || undefined,
      consigneeName: form.consigneeName,
      consigneeAddress: form.consigneeAddress || undefined,
      notifyParty: form.notifyParty || undefined,
      commodity: form.commodity,
      hsCode: form.hsCode || undefined,
      grossWeight: form.grossWeight || undefined,
      netWeight: form.netWeight || undefined,
      quantity: form.quantity ? Number(form.quantity) : undefined,
      packingType: form.packingType || undefined,
      dimensions: form.dimensions || undefined,
      marksAndNumbers: form.marksAndNumbers || undefined,
      measurement: form.measurement || undefined,
      origin: form.origin,
      destination: form.destination,
      portOfLoading: form.portOfLoading || undefined,
      portOfDischarge: form.portOfDischarge || undefined,
      vessel: form.vessel || undefined,
      voyage: form.voyage || undefined,
      notes: form.notes || undefined,
      transportMode: (form.transportMode || undefined) as any,
      cargoType: (form.cargoType || undefined) as any,
      containerNo: form.containerNo || undefined,
      freightCost: form.freightCost ? Number(form.freightCost) : undefined,
      salesDocId: salesDocId ?? undefined,
      purchaseDocId: isEdit ? purchaseDocId : (purchaseDocId ?? undefined),
    } as any;

    if (isEdit && id) {
      update.mutate(
        { id, data: payload },
        {
          onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: getListFreightShipmentsQueryKey() });
            toast({ title: t.common.success });
            navigate(`/logistics/freight/${res.id}`);
          },
          onError: () => toast({ title: t.common.error, variant: "destructive" }),
        }
      );
    } else {
      create.mutate(
        { data: payload },
        {
          onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: getListFreightShipmentsQueryKey() });
            toast({ title: t.common.success });
            navigate(`/logistics/freight/${res.id}`);
          },
          onError: () => toast({ title: t.common.error, variant: "destructive" }),
        }
      );
    }
  };

  const isBusy = create.isPending || update.isPending;

  const [showScanDialog, setShowScanDialog] = useState(false);

  const applyScannedFields = (fields: FreightFormFields) => {
    const newlyScanned = new Set<string>();
    const scanFieldKeys: (keyof FreightFormFields)[] = [
      "shipperName", "shipperAddress", "consigneeName", "consigneeAddress",
      "notifyParty", "commodity", "hsCode", "grossWeight", "netWeight",
      "quantity", "packingType", "dimensions", "marksAndNumbers", "measurement",
      "origin", "destination", "portOfLoading", "portOfDischarge",
      "vessel", "voyage", "containerNo", "notes",
    ];
    for (const key of scanFieldKeys) {
      if (fields[key] !== undefined && fields[key] !== null) newlyScanned.add(key);
    }
    if ((fields as any).transportMode !== undefined && (fields as any).transportMode !== null) newlyScanned.add("transportMode");
    setScannedFields((prev) => new Set([...prev, ...newlyScanned]));
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null)) }));
    toast({ title: t.common.success });
  };

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/logistics/freight")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold flex-1">
            {isEdit ? "Edit Freight Shipment" : "Buat Freight Shipment Baru"}
          </h1>
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowScanDialog(true)}
            className="gap-2"
          >
            <ScanLine className="h-4 w-4" />
            Scan Dokumen
          </Button>
        </div>

        {isEdit && loadingExisting ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">Memuat...</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Sales Order picker — required for new shipments */}
            {!isEdit && (
              <Card className={!salesDocId ? "border-destructive/50 bg-destructive/5" : ""}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Sales Order
                    <span className="text-destructive text-sm font-normal">* wajib</span>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">Pilih Sales Order yang terkait dengan shipment ini. Data konsignee dan rute akan diisi otomatis.</p>
                </CardHeader>
                <CardContent>
                  {salesDocId ? (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 p-3 rounded-lg border bg-muted/20">
                        {(() => {
                          const doc = salesOrders.find((d) => d.id === salesDocId);
                          return doc ? (
                            <div className="flex items-center gap-4">
                              <span className="font-mono font-semibold text-sm">{doc.docNumber}</span>
                              <span className="text-sm text-muted-foreground">{doc.customerName}</span>
                            </div>
                          ) : (
                            <span className="text-sm font-mono">SO #{salesDocId}</span>
                          );
                        })()}
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => {
                        setForm((f) => ({
                          ...f,
                          consigneeName: (consigneeNameAutoFilled && f.consigneeName === consigneeNameAutoFilledValue) ? "" : f.consigneeName,
                          consigneeAddress: (consigneeAddressAutoFilled && f.consigneeAddress === consigneeAddressAutoFilledValue) ? "" : f.consigneeAddress,
                          origin: (originAutoFilled && f.origin === originAutoFilledValue) ? "" : f.origin,
                          destination: (destinationAutoFilled && f.destination === destinationAutoFilledValue) ? "" : f.destination,
                          transportMode: (transportModeAutoFilled && f.transportMode === transportModeAutoFilledValue) ? "" : f.transportMode,
                        }));
                        setConsigneeNameAutoFilled(false);
                        setConsigneeAddressAutoFilled(false);
                        setOriginAutoFilled(false);
                        setDestinationAutoFilled(false);
                        setTransportModeAutoFilled(false);
                        setSalesDocId(null);
                      }}>
                        Ganti
                      </Button>
                    </div>
                  ) : (
                    <Popover open={soPickerOpen} onOpenChange={setSoPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          aria-expanded={soPickerOpen}
                          className="w-full justify-between"
                        >
                          Pilih Sales Order...
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[400px] p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Cari nomor SO atau nama pelanggan..." />
                          <CommandList>
                            <CommandEmpty>Tidak ada Sales Order yang cocok.</CommandEmpty>
                            <CommandGroup>
                              {salesOrders.map((doc) => (
                                <CommandItem
                                  key={doc.id}
                                  value={`${doc.docNumber} ${doc.customerName}`}
                                  onSelect={() => handleSelectSo(doc.id)}
                                >
                                  <Check className={`mr-2 h-4 w-4 ${salesDocId === doc.id ? "opacity-100" : "opacity-0"}`} />
                                  <span className="font-mono mr-2">{doc.docNumber}</span>
                                  <span className="text-muted-foreground text-sm truncate">{doc.customerName}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Purchase Order picker — optional, available for both create and edit */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Purchase Order
                  <span className="text-muted-foreground text-sm font-normal">(opsional)</span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">Tautkan ke Purchase Order yang terkait dengan shipment ini. Nama supplier akan diisi otomatis ke kolom Shipper jika belum terisi.</p>
              </CardHeader>
              <CardContent>
                {purchaseDocId ? (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 p-3 rounded-lg border bg-muted/20">
                      {(() => {
                        const doc = purchaseOrders.find((d) => d.id === purchaseDocId);
                        return doc ? (
                          <div className="flex items-center gap-4">
                            <span className="font-mono font-semibold text-sm">{doc.docNumber}</span>
                            <span className="text-sm text-muted-foreground">{doc.supplierName}</span>
                          </div>
                        ) : (
                          <span className="text-sm font-mono">PO #{purchaseDocId}</span>
                        );
                      })()}
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => clearPOLink(true)}>
                      Ganti
                    </Button>
                    <Button type="button" variant="outline" size="sm"
                      className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
                      data-testid="clear-po-button"
                      onClick={() => clearPOLink(false)}>
                      <X className="mr-1 h-3.5 w-3.5" />
                      Hapus PO
                    </Button>
                  </div>
                ) : (
                  <Popover open={poPickerOpen} onOpenChange={setPoPickerOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={poPickerOpen}
                        className="w-full justify-between"
                        data-testid="po-picker-trigger"
                      >
                        Pilih Purchase Order...
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[400px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Cari nomor PO atau nama supplier..." />
                        <CommandList>
                          <CommandEmpty>Tidak ada Purchase Order yang cocok.</CommandEmpty>
                          <CommandGroup>
                            {purchaseOrders.map((doc) => (
                              <CommandItem
                                key={doc.id}
                                value={`${doc.docNumber} ${doc.supplierName}`}
                                onSelect={() => handleSelectPo(doc.id)}
                              >
                                <Check className={`mr-2 h-4 w-4 ${purchaseDocId === doc.id ? "opacity-100" : "opacity-0"}`} />
                                <span className="font-mono mr-2">{doc.docNumber}</span>
                                <span className="text-muted-foreground text-sm truncate">{doc.supplierName}</span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Informasi Shipper</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">Pilih dari katalog vendor untuk mengisi nama dan alamat shipper secara otomatis.</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedVendorId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={handleOpenEditVendorDialog}
                        data-testid="edit-vendor-btn"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit Vendor
                      </Button>
                    )}
                  <Popover open={vendorPickerOpen} onOpenChange={(open) => { setVendorPickerOpen(open); if (!open) setVendorSearchQuery(""); }}>
                    <PopoverTrigger asChild>
                      {(() => {
                        const sv = selectedVendorId ? suppliers.find((s) => s.id === selectedVendorId) : null;
                        return (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5 max-w-[200px]"
                            data-testid="vendor-picker-trigger"
                          >
                            {sv ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                                <span className="truncate">{sv.name}</span>
                              </>
                            ) : (
                              <>
                                <ChevronsUpDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
                                Pilih Vendor
                              </>
                            )}
                          </Button>
                        );
                      })()}
                    </PopoverTrigger>
                    <PopoverContent className="w-[360px] p-0" align="end">
                      <Command>
                        <CommandInput
                          placeholder="Cari nama vendor..."
                          value={vendorSearchQuery}
                          onValueChange={setVendorSearchQuery}
                        />
                        <CommandList>
                          <CommandEmpty>
                            <div className="py-2 px-1 text-center">
                              <p className="text-sm text-muted-foreground mb-2">Tidak ada vendor yang cocok.</p>
                              {vendorSearchQuery.trim() && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1.5 text-sm text-primary font-medium hover:underline"
                                  onClick={() => handleOpenAddVendorDialog(vendorSearchQuery.trim())}
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  Tambah &ldquo;{vendorSearchQuery.trim()}&rdquo; sebagai vendor baru
                                </button>
                              )}
                            </div>
                          </CommandEmpty>
                          {selectedVendorId && (
                            <CommandGroup>
                              <CommandItem
                                value="__clear_vendor__"
                                onSelect={() => {
                                  setSelectedVendorId(null);
                                  setVendorPickerOpen(false);
                                  setVendorSearchQuery("");
                                  if (shipperVendorNameFilled) {
                                    setForm((f) => ({ ...f, shipperName: f.shipperName === shipperVendorNameValue ? "" : f.shipperName }));
                                    setShipperVendorNameFilled(false);
                                    setShipperVendorNameValue("");
                                  }
                                  if (shipperVendorAddressFilled) {
                                    setForm((f) => ({ ...f, shipperAddress: f.shipperAddress === shipperVendorAddressValue ? "" : f.shipperAddress }));
                                    setShipperVendorAddressFilled(false);
                                    setShipperVendorAddressValue("");
                                  }
                                }}
                                className="text-destructive aria-selected:text-destructive"
                                data-testid="clear-vendor-item"
                              >
                                <X className="mr-2 h-4 w-4" />
                                Hapus vendor
                              </CommandItem>
                            </CommandGroup>
                          )}
                          <CommandGroup heading="Katalog Vendor">
                            {suppliers.map((s) => (
                              <CommandItem
                                key={s.id}
                                value={`${s.name} ${s.country}`}
                                onSelect={() => handleSelectVendor(s.id)}
                              >
                                <Check className={`mr-2 h-4 w-4 ${selectedVendorId === s.id ? "opacity-100" : "opacity-0"}`} />
                                <div className="flex flex-col">
                                  <span className="font-medium">{s.name}</span>
                                  {s.address && <span className="text-xs text-muted-foreground truncate">{s.address}</span>}
                                  {!s.address && <span className="text-xs text-muted-foreground/60 italic">Alamat belum diisi di katalog</span>}
                                </div>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {purchaseDocId && !purchaseOrders.find((d) => d.id === purchaseDocId)?.supplierAddress && !shipperCatalogAddressFilled && (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    <span className="mt-0.5 shrink-0">⚠️</span>
                    <span>Purchase Order yang dipilih tidak memiliki alamat supplier. Masukkan alamat shipper secara manual, atau gunakan tombol <strong>Pilih Vendor</strong> di atas untuk mengisinya dari katalog vendor.</span>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="shipperName">Nama Shipper <span className="text-destructive">*</span></Label>
                      {shipperNameAutoFilled && dismissedBadges.has("shipperName:po") && (
                        <AutofillRestoreMarker source="po" fieldKey="shipperName" originalValue={shipperNameAutoFilledValue} currentValue={form.shipperName} onRestore={() => { setForm((f) => ({ ...f, shipperName: shipperNameAutoFilledValue })); clearDismissedBadges("shipperName:po"); setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperName"); return next; }); }} />
                      )}
                      {shipperVendorNameFilled && dismissedBadges.has("shipperName:vendor") && (
                        <AutofillRestoreMarker source="vendor" fieldKey="shipperName" originalValue={shipperVendorNameValue} currentValue={form.shipperName} onRestore={() => { setForm((f) => ({ ...f, shipperName: shipperVendorNameValue })); clearDismissedBadges("shipperName:vendor"); }} />
                      )}
                    </div>
                    <Input id="shipperName" value={form.shipperName} onChange={set("shipperName")} placeholder="PT. Contoh Shipper" required className={`${scannedFields.has("shipperName") ? "ring-1 ring-green-400" : ""} ${(shipperNameAutoFilled && dismissedBadges.has("shipperName:po")) ? "border-l-2 border-l-blue-300" : (shipperVendorNameFilled && dismissedBadges.has("shipperName:vendor")) ? "border-l-2 border-l-purple-300" : ""}`.trim()} />
                    {((shipperNameAutoFilled && !dismissedBadges.has("shipperName:po")) || (shipperVendorNameFilled && !dismissedBadges.has("shipperName:vendor")) || scannedFields.has("shipperName")) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {shipperNameAutoFilled && !dismissedBadges.has("shipperName:po") && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">Dari PO<button type="button" onClick={() => dismissBadge("shipperName:po")} className="hover:text-blue-900 leading-none" aria-label="Tutup">×</button></span>}
                        {shipperVendorNameFilled && !dismissedBadges.has("shipperName:vendor") && <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-medium">Dari Vendor<button type="button" onClick={() => dismissBadge("shipperName:vendor")} className="hover:text-purple-900 leading-none" aria-label="Tutup">×</button></span>}
                        {scannedFields.has("shipperName") && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("shipperName")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>}
                        {shipperNameAutoFilled && !dismissedBadges.has("shipperName:po") ? "Diisi otomatis dari Purchase Order." : shipperVendorNameFilled && !dismissedBadges.has("shipperName:vendor") ? "Diisi otomatis dari katalog vendor." : "Diisi dari scan dokumen."}
                        {shipperNameAutoFilled && form.shipperName !== shipperNameAutoFilledValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, shipperName: shipperNameAutoFilledValue })); setShipperNameAutoFilled(true); clearDismissedBadges("shipperName:po"); setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperName"); return next; }); }} className="text-blue-600 hover:underline font-medium ml-1">Pulihkan dari PO</button>
                        )}
                        {shipperVendorNameFilled && form.shipperName !== shipperVendorNameValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, shipperName: shipperVendorNameValue })); setShipperVendorNameFilled(true); }} className="text-purple-600 hover:underline font-medium ml-1">Pulihkan dari Vendor</button>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="shipperAddress">Alamat Shipper</Label>
                      {shipperAddressAutoFilled && dismissedBadges.has("shipperAddress:po") && (
                        <AutofillRestoreMarker source="po" fieldKey="shipperAddress" originalValue={shipperAddressAutoFilledValue} currentValue={form.shipperAddress} onRestore={() => { setForm((f) => ({ ...f, shipperAddress: shipperAddressAutoFilledValue })); clearDismissedBadges("shipperAddress:po"); setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperAddress"); return next; }); }} />
                      )}
                      {shipperVendorAddressFilled && dismissedBadges.has("shipperAddress:vendor") && (
                        <AutofillRestoreMarker source="vendor" fieldKey="shipperAddress" originalValue={shipperVendorAddressValue} currentValue={form.shipperAddress} onRestore={() => { setForm((f) => ({ ...f, shipperAddress: shipperVendorAddressValue })); clearDismissedBadges("shipperAddress:vendor"); }} />
                      )}
                      {shipperCatalogAddressFilled && dismissedBadges.has("shipperAddress:catalog") && (
                        <AutofillRestoreMarker source="catalog" fieldKey="shipperAddress" originalValue={shipperCatalogAddressValue} currentValue={form.shipperAddress} onRestore={() => { setForm((f) => ({ ...f, shipperAddress: shipperCatalogAddressValue })); clearDismissedBadges("shipperAddress:catalog"); }} />
                      )}
                    </div>
                    <GooglePlacesAutocomplete
                      value={form.shipperAddress}
                      onChange={(v) => setForm((f) => ({ ...f, shipperAddress: v }))}
                      placeholder="Jl. ..."
                      className={`${scannedFields.has("shipperAddress") ? "ring-1 ring-green-400" : ""} ${(shipperAddressAutoFilled && dismissedBadges.has("shipperAddress:po")) ? "border-l-2 border-l-blue-300" : (shipperVendorAddressFilled && dismissedBadges.has("shipperAddress:vendor")) ? "border-l-2 border-l-purple-300" : (shipperCatalogAddressFilled && dismissedBadges.has("shipperAddress:catalog")) ? "border-l-2 border-l-amber-300" : ""}`.trim()}
                    />
                    {((shipperAddressAutoFilled && !dismissedBadges.has("shipperAddress:po")) || (shipperVendorAddressFilled && !dismissedBadges.has("shipperAddress:vendor")) || (shipperCatalogAddressFilled && !dismissedBadges.has("shipperAddress:catalog")) || scannedFields.has("shipperAddress")) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {shipperAddressAutoFilled && !dismissedBadges.has("shipperAddress:po") && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">Dari PO<button type="button" onClick={() => dismissBadge("shipperAddress:po")} className="hover:text-blue-900 leading-none" aria-label="Tutup">×</button></span>}
                        {shipperVendorAddressFilled && !dismissedBadges.has("shipperAddress:vendor") && <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 text-purple-700 px-2 py-0.5 text-[10px] font-medium">Dari Vendor<button type="button" onClick={() => dismissBadge("shipperAddress:vendor")} className="hover:text-purple-900 leading-none" aria-label="Tutup">×</button></span>}
                        {shipperCatalogAddressFilled && !dismissedBadges.has("shipperAddress:catalog") && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-medium">Dari Vendor (via katalog)<button type="button" onClick={() => dismissBadge("shipperAddress:catalog")} className="hover:text-amber-900 leading-none" aria-label="Tutup">×</button></span>}
                        {scannedFields.has("shipperAddress") && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("shipperAddress")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>}
                        {shipperAddressAutoFilled && !dismissedBadges.has("shipperAddress:po") ? "Diisi otomatis dari Purchase Order." : shipperVendorAddressFilled && !dismissedBadges.has("shipperAddress:vendor") ? "Diisi otomatis dari katalog vendor." : shipperCatalogAddressFilled && !dismissedBadges.has("shipperAddress:catalog") ? "Alamat PO kosong — diisi dari katalog vendor berdasarkan nama supplier." : "Diisi dari scan dokumen."}
                        {shipperAddressAutoFilled && form.shipperAddress !== shipperAddressAutoFilledValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, shipperAddress: shipperAddressAutoFilledValue })); setShipperAddressAutoFilled(true); clearDismissedBadges("shipperAddress:po"); setScannedFields((prev) => { const next = new Set(prev); next.delete("shipperAddress"); return next; }); }} className="text-blue-600 hover:underline font-medium ml-1">Pulihkan dari PO</button>
                        )}
                        {shipperVendorAddressFilled && form.shipperAddress !== shipperVendorAddressValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, shipperAddress: shipperVendorAddressValue })); setShipperVendorAddressFilled(true); }} className="text-purple-600 hover:underline font-medium ml-1">Pulihkan dari Vendor</button>
                        )}
                        {shipperCatalogAddressFilled && form.shipperAddress !== shipperCatalogAddressValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, shipperAddress: shipperCatalogAddressValue })); setShipperCatalogAddressFilled(true); }} className="text-amber-600 hover:underline font-medium ml-1">Pulihkan dari katalog</button>
                        )}
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Informasi Consignee</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="consigneeName">Nama Consignee <span className="text-destructive">*</span></Label>
                      {consigneeNameAutoFilled && dismissedBadges.has("consigneeName:so") && (
                        <AutofillRestoreMarker source="so" fieldKey="consigneeName" originalValue={consigneeNameAutoFilledValue} currentValue={form.consigneeName} onRestore={() => { setForm((f) => ({ ...f, consigneeName: consigneeNameAutoFilledValue })); clearDismissedBadges("consigneeName:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("consigneeName"); return next; }); }} />
                      )}
                    </div>
                    <Input id="consigneeName" value={form.consigneeName} onChange={set("consigneeName")} placeholder="PT. Contoh Consignee" required className={`${scannedFields.has("consigneeName") ? "ring-1 ring-green-400" : ""} ${(consigneeNameAutoFilled && dismissedBadges.has("consigneeName:so")) ? "border-l-2 border-l-blue-300" : ""}`.trim()} />
                    {((consigneeNameAutoFilled && !dismissedBadges.has("consigneeName:so")) || scannedFields.has("consigneeName")) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {consigneeNameAutoFilled && !dismissedBadges.has("consigneeName:so") && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">Dari SO<button type="button" onClick={() => dismissBadge("consigneeName:so")} className="hover:text-blue-900 leading-none" aria-label="Tutup">×</button></span>}
                        {scannedFields.has("consigneeName") && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("consigneeName")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>}
                        {consigneeNameAutoFilled && !dismissedBadges.has("consigneeName:so") ? "Diisi otomatis dari Sales Order." : "Diisi dari scan dokumen."}
                        {consigneeNameAutoFilled && form.consigneeName !== consigneeNameAutoFilledValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, consigneeName: consigneeNameAutoFilledValue })); setConsigneeNameAutoFilled(true); clearDismissedBadges("consigneeName:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("consigneeName"); return next; }); }} className="text-blue-600 hover:underline font-medium ml-1">Pulihkan dari SO</button>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="consigneeAddress">Alamat Consignee</Label>
                      {consigneeAddressAutoFilled && dismissedBadges.has("consigneeAddress:so") && (
                        <AutofillRestoreMarker source="so" fieldKey="consigneeAddress" originalValue={consigneeAddressAutoFilledValue} currentValue={form.consigneeAddress} onRestore={() => { setForm((f) => ({ ...f, consigneeAddress: consigneeAddressAutoFilledValue })); clearDismissedBadges("consigneeAddress:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("consigneeAddress"); return next; }); }} />
                      )}
                    </div>
                    <GooglePlacesAutocomplete
                      value={form.consigneeAddress}
                      onChange={(v) => setForm((f) => ({ ...f, consigneeAddress: v }))}
                      placeholder="Jl. ..."
                      className={`${scannedFields.has("consigneeAddress") ? "ring-1 ring-green-400" : ""} ${(consigneeAddressAutoFilled && dismissedBadges.has("consigneeAddress:so")) ? "border-l-2 border-l-blue-300" : ""}`.trim()}
                    />
                    {((consigneeAddressAutoFilled && !dismissedBadges.has("consigneeAddress:so")) || scannedFields.has("consigneeAddress")) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {consigneeAddressAutoFilled && !dismissedBadges.has("consigneeAddress:so") && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">Dari SO<button type="button" onClick={() => dismissBadge("consigneeAddress:so")} className="hover:text-blue-900 leading-none" aria-label="Tutup">×</button></span>}
                        {scannedFields.has("consigneeAddress") && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("consigneeAddress")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>}
                        {consigneeAddressAutoFilled && !dismissedBadges.has("consigneeAddress:so") ? "Diisi otomatis dari Sales Order." : "Diisi dari scan dokumen."}
                        {consigneeAddressAutoFilled && form.consigneeAddress !== consigneeAddressAutoFilledValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, consigneeAddress: consigneeAddressAutoFilledValue })); setConsigneeAddressAutoFilled(true); clearDismissedBadges("consigneeAddress:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("consigneeAddress"); return next; }); }} className="text-blue-600 hover:underline font-medium ml-1">Pulihkan dari SO</button>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notifyParty">Notify Party</Label>
                  <Input id="notifyParty" value={form.notifyParty} onChange={set("notifyParty")} placeholder="Nama / alamat pihak yang diberitahu (jika berbeda dengan consignee)" className={scannedFields.has("notifyParty") ? "ring-1 ring-green-400" : ""} />
                  {scannedFields.has("notifyParty") && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("notifyParty")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                      Diisi dari scan dokumen.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Mini map — ditampilkan ketika kedua alamat sudah diisi */}
            {(form.shipperAddress || form.consigneeAddress) && (
              <RouteMapPreview
                origin={form.shipperAddress}
                destination={form.consigneeAddress}
                onDistanceFetched={handleDistanceFetched}
              />
            )}

            {/* Biaya Freight */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-4 w-4" />
                  Biaya Freight
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
                  <div className="space-y-1.5">
                    <Label>Jarak (km)</Label>
                    <input
                      type="number"
                      min={0}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={routeDistanceKm ?? ""}
                      onChange={(e) => setRouteDistanceKm(e.target.value ? Number(e.target.value) : null)}
                      placeholder="Auto dari peta"
                    />
                    <p className="text-[11px] text-muted-foreground">Otomatis dari alamat shipper→consignee</p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Tarif per km (Rp)</Label>
                    <input
                      type="number"
                      min={0}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={ratePerKm}
                      onChange={(e) => setRatePerKm(e.target.value)}
                      placeholder="cth. 5000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Estimasi Biaya</Label>
                    <div className="flex h-9 items-center rounded-md border bg-muted/50 px-3 text-sm font-medium">
                      {routeDistanceKm != null && ratePerKm
                        ? `Rp ${Math.round(routeDistanceKm * Number(ratePerKm)).toLocaleString("id-ID")}`
                        : <span className="text-muted-foreground font-normal">—</span>}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>&nbsp;</Label>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      disabled={routeDistanceKm == null || !ratePerKm}
                      onClick={() => {
                        if (routeDistanceKm != null && ratePerKm) {
                          setForm((f) => ({ ...f, freightCost: String(Math.round(routeDistanceKm * Number(ratePerKm))) }));
                        }
                      }}
                    >
                      Pakai sebagai biaya
                    </Button>
                  </div>
                </div>
                <Separator />
                <div className="space-y-1.5">
                  <Label htmlFor="freightCost">Biaya Freight Aktual (Rp)</Label>
                  <input
                    id="freightCost"
                    type="number"
                    min={0}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={form.freightCost}
                    onChange={(e) => setForm((f) => ({ ...f, freightCost: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Detail Kargo</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="commodity">Komoditi <span className="text-destructive">*</span></Label>
                    <Input id="commodity" value={form.commodity} onChange={set("commodity")} placeholder="Elektronik, Tekstil, dll." required className={scannedFields.has("commodity") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("commodity") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("commodity")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="hsCode">HS Code</Label>
                    <Input id="hsCode" value={form.hsCode} onChange={set("hsCode")} placeholder="8471.30.00" className={scannedFields.has("hsCode") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("hsCode") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("hsCode")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="grossWeight">Berat Bruto (kg)</Label>
                    <Input id="grossWeight" type="number" step="0.01" value={form.grossWeight} onChange={set("grossWeight")} placeholder="0" className={scannedFields.has("grossWeight") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("grossWeight") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("grossWeight")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="netWeight">Berat Neto (kg)</Label>
                    <Input id="netWeight" type="number" step="0.01" value={form.netWeight} onChange={set("netWeight")} placeholder="0" className={scannedFields.has("netWeight") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("netWeight") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("netWeight")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Jumlah</Label>
                    <Input id="quantity" type="number" value={form.quantity} onChange={set("quantity")} placeholder="0" className={scannedFields.has("quantity") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("quantity") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("quantity")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="packingType">Jenis Packing</Label>
                    <Input id="packingType" value={form.packingType} onChange={set("packingType")} placeholder="Karton, Pallet, dll." className={scannedFields.has("packingType") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("packingType") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("packingType")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dimensions">Dimensi</Label>
                  <Input id="dimensions" value={form.dimensions} onChange={set("dimensions")} placeholder="P x L x T cm" className={scannedFields.has("dimensions") ? "ring-1 ring-green-400" : ""} />
                  {scannedFields.has("dimensions") && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("dimensions")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                      Diisi dari scan dokumen.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Rute &amp; Moda Pengiriman</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="origin">Asal <span className="text-destructive">*</span></Label>
                      {originAutoFilled && dismissedBadges.has("origin:so") && (
                        <AutofillRestoreMarker source="so" fieldKey="origin" originalValue={originAutoFilledValue} currentValue={form.origin} onRestore={() => { setForm((f) => ({ ...f, origin: originAutoFilledValue })); clearDismissedBadges("origin:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("origin"); return next; }); }} />
                      )}
                    </div>
                    <Input id="origin" value={form.origin} onChange={set("origin")} placeholder="Jakarta, Indonesia" required className={`${scannedFields.has("origin") ? "ring-1 ring-green-400" : ""} ${(originAutoFilled && dismissedBadges.has("origin:so")) ? "border-l-2 border-l-blue-300" : ""}`.trim()} />
                    {((originAutoFilled && !dismissedBadges.has("origin:so")) || scannedFields.has("origin")) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {originAutoFilled && !dismissedBadges.has("origin:so") && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">Dari SO<button type="button" onClick={() => dismissBadge("origin:so")} className="hover:text-blue-900 leading-none" aria-label="Tutup">×</button></span>}
                        {scannedFields.has("origin") && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("origin")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>}
                        {originAutoFilled && !dismissedBadges.has("origin:so") ? "Diisi otomatis dari Sales Order." : "Diisi dari scan dokumen."}
                        {originAutoFilled && !dismissedBadges.has("origin:so") && form.origin !== originAutoFilledValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, origin: originAutoFilledValue })); setOriginAutoFilled(true); clearDismissedBadges("origin:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("origin"); return next; }); }} className="text-blue-600 hover:underline font-medium ml-1">Pulihkan dari SO</button>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label htmlFor="destination">Tujuan <span className="text-destructive">*</span></Label>
                      {destinationAutoFilled && dismissedBadges.has("destination:so") && (
                        <AutofillRestoreMarker source="so" fieldKey="destination" originalValue={destinationAutoFilledValue} currentValue={form.destination} onRestore={() => { setForm((f) => ({ ...f, destination: destinationAutoFilledValue })); clearDismissedBadges("destination:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("destination"); return next; }); }} />
                      )}
                    </div>
                    <Input id="destination" value={form.destination} onChange={set("destination")} placeholder="Singapore" required className={`${scannedFields.has("destination") ? "ring-1 ring-green-400" : ""} ${(destinationAutoFilled && dismissedBadges.has("destination:so")) ? "border-l-2 border-l-blue-300" : ""}`.trim()} />
                    {((destinationAutoFilled && !dismissedBadges.has("destination:so")) || scannedFields.has("destination")) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {destinationAutoFilled && !dismissedBadges.has("destination:so") && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">Dari SO<button type="button" onClick={() => dismissBadge("destination:so")} className="hover:text-blue-900 leading-none" aria-label="Tutup">×</button></span>}
                        {scannedFields.has("destination") && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("destination")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>}
                        {destinationAutoFilled && !dismissedBadges.has("destination:so") ? "Diisi otomatis dari Sales Order." : "Diisi dari scan dokumen."}
                        {destinationAutoFilled && !dismissedBadges.has("destination:so") && form.destination !== destinationAutoFilledValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, destination: destinationAutoFilledValue })); setDestinationAutoFilled(true); clearDismissedBadges("destination:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("destination"); return next; }); }} className="text-blue-600 hover:underline font-medium ml-1">Pulihkan dari SO</button>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label>Moda Transportasi</Label>
                      {transportModeAutoFilled && dismissedBadges.has("transportMode:so") && (
                        <AutofillRestoreMarker source="so" fieldKey="transportMode" originalValue={transportModeAutoFilledValue} currentValue={form.transportMode} onRestore={() => { setForm((f) => ({ ...f, transportMode: transportModeAutoFilledValue })); clearDismissedBadges("transportMode:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("transportMode"); return next; }); }} />
                      )}
                    </div>
                    <Select value={form.transportMode || "__none"} onValueChange={(v) => { setForm((f) => ({ ...f, transportMode: v === "__none" ? "" : v })); setScannedFields((prev) => { const next = new Set(prev); next.delete("transportMode"); return next; }); }}>
                      <SelectTrigger className={`${scannedFields.has("transportMode") ? "ring-1 ring-green-400" : ""} ${(transportModeAutoFilled && dismissedBadges.has("transportMode:so")) ? "border-l-2 border-l-blue-300" : ""}`.trim()}><SelectValue placeholder="Pilih moda..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">— Belum ditentukan —</SelectItem>
                        <SelectItem value="sea">Laut (Sea)</SelectItem>
                        <SelectItem value="air">Udara (Air)</SelectItem>
                        <SelectItem value="land">Darat (Land)</SelectItem>
                        <SelectItem value="multimodal">Multimodal</SelectItem>
                      </SelectContent>
                    </Select>
                    {((transportModeAutoFilled && !dismissedBadges.has("transportMode:so")) || scannedFields.has("transportMode")) && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
                        {transportModeAutoFilled && !dismissedBadges.has("transportMode:so") && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-medium">Dari SO<button type="button" onClick={() => dismissBadge("transportMode:so")} className="hover:text-blue-900 leading-none" aria-label="Tutup">×</button></span>}
                        {scannedFields.has("transportMode") && <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("transportMode")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>}
                        {transportModeAutoFilled && !dismissedBadges.has("transportMode:so") ? "Diisi otomatis dari Sales Order." : "Diisi dari scan dokumen."}
                        {transportModeAutoFilled && !dismissedBadges.has("transportMode:so") && form.transportMode !== transportModeAutoFilledValue && (
                          <button type="button" onClick={() => { setForm((f) => ({ ...f, transportMode: transportModeAutoFilledValue })); setTransportModeAutoFilled(true); clearDismissedBadges("transportMode:so"); setScannedFields((prev) => { const next = new Set(prev); next.delete("transportMode"); return next; }); }} className="text-blue-600 hover:underline font-medium ml-1">Pulihkan dari SO</button>
                        )}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>Jenis Kargo</Label>
                    <Select value={form.cargoType || "__none"} onValueChange={(v) => setForm((f) => ({ ...f, cargoType: v === "__none" ? "" : v }))}>
                      <SelectTrigger><SelectValue placeholder="Pilih jenis..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">— Belum ditentukan —</SelectItem>
                        <SelectItem value="FCL">FCL (Full Container Load)</SelectItem>
                        <SelectItem value="LCL">LCL (Less than Container Load)</SelectItem>
                        <SelectItem value="Air">Air Cargo</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="containerNo">Nomor Kontainer</Label>
                  <Input id="containerNo" value={form.containerNo} onChange={set("containerNo")} placeholder="MSCU1234567" className={scannedFields.has("containerNo") ? "ring-1 ring-green-400" : ""} />
                  {scannedFields.has("containerNo") && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("containerNo")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                      Diisi dari scan dokumen.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Informasi Moda Pengiriman</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="portOfLoading">Port of Loading</Label>
                    <Input id="portOfLoading" value={form.portOfLoading} onChange={set("portOfLoading")} placeholder="Tanjung Priok, Jakarta" className={scannedFields.has("portOfLoading") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("portOfLoading") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("portOfLoading")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="portOfDischarge">Port of Discharge</Label>
                    <Input id="portOfDischarge" value={form.portOfDischarge} onChange={set("portOfDischarge")} placeholder="Port of Singapore" className={scannedFields.has("portOfDischarge") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("portOfDischarge") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("portOfDischarge")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vessel">Vessel / Freight Carrier</Label>
                    <Input id="vessel" value={form.vessel} onChange={set("vessel")} placeholder="MV. Contoh Kapal" className={scannedFields.has("vessel") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("vessel") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("vessel")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="voyage">Voyage No.</Label>
                    <Input id="voyage" value={form.voyage} onChange={set("voyage")} placeholder="VY-001" className={scannedFields.has("voyage") ? "ring-1 ring-green-400" : ""} />
                    {scannedFields.has("voyage") && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("voyage")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                        Diisi dari scan dokumen.
                      </p>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="marksAndNumbers">Marks & Numbers</Label>
                  <Textarea
                    id="marksAndNumbers"
                    value={form.marksAndNumbers}
                    onChange={set("marksAndNumbers")}
                    placeholder="Tanda / nomor pada kemasan..."
                    rows={2}
                    className={scannedFields.has("marksAndNumbers") ? "ring-1 ring-green-400" : ""}
                  />
                  {scannedFields.has("marksAndNumbers") && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("marksAndNumbers")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                      Diisi dari scan dokumen.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="measurement">Measurement (CBM)</Label>
                  <Input id="measurement" value={form.measurement} onChange={set("measurement")} placeholder="cth: 12.5 CBM" className={scannedFields.has("measurement") ? "ring-1 ring-green-400" : ""} />
                  {scannedFields.has("measurement") && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("measurement")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                      Diisi dari scan dokumen.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Catatan</CardTitle></CardHeader>
              <CardContent>
                <Textarea
                  value={form.notes}
                  onChange={set("notes")}
                  placeholder="Catatan tambahan..."
                  rows={3}
                  className={scannedFields.has("notes") ? "ring-1 ring-green-400" : ""}
                />
                {scannedFields.has("notes") && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-[10px] font-medium">Dari Scan<button type="button" onClick={() => dismissScannedField("notes")} className="hover:text-green-900 leading-none" aria-label="Tutup">×</button></span>
                    Diisi dari scan dokumen.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => navigate("/logistics/freight")}>
                Batal
              </Button>
              <Button type="submit" disabled={isBusy}>
                {isBusy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {isEdit ? "Simpan Perubahan" : "Buat Shipment"}
              </Button>
            </div>
          </form>
        )}
      </div>

      <FreightScanDialog
        open={showScanDialog}
        onOpenChange={setShowScanDialog}
        onApply={applyScannedFields}
      />

      <Dialog open={editVendorDialogOpen} onOpenChange={setEditVendorDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Vendor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="editVendorName">Nama Vendor <span className="text-destructive">*</span></Label>
              <Input
                id="editVendorName"
                value={editVendorForm.name}
                onChange={(e) => setEditVendorForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="PT. Contoh Vendor"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editVendorCountry">Negara <span className="text-destructive">*</span></Label>
              <Input
                id="editVendorCountry"
                value={editVendorForm.country}
                onChange={(e) => setEditVendorForm((f) => ({ ...f, country: e.target.value }))}
                placeholder="Indonesia"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="editVendorAddress">Alamat</Label>
              <Textarea
                id="editVendorAddress"
                value={editVendorForm.address}
                onChange={(e) => setEditVendorForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Jl. Contoh No. 1, Jakarta"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditVendorDialogOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleSaveEditVendor}
              disabled={updateSupplier.isPending}
            >
              {updateSupplier.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addVendorDialogOpen} onOpenChange={setAddVendorDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Vendor Baru</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="newVendorName">Nama Vendor <span className="text-destructive">*</span></Label>
              <Input
                id="newVendorName"
                value={newVendorForm.name}
                onChange={(e) => setNewVendorForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="PT. Contoh Vendor"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newVendorCountry">Negara <span className="text-destructive">*</span></Label>
              <Input
                id="newVendorCountry"
                value={newVendorForm.country}
                onChange={(e) => setNewVendorForm((f) => ({ ...f, country: e.target.value }))}
                placeholder="Indonesia"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newVendorAddress">Alamat</Label>
              <Textarea
                id="newVendorAddress"
                value={newVendorForm.address}
                onChange={(e) => setNewVendorForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="Jl. Contoh No. 1, Jakarta"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddVendorDialogOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              onClick={handleSaveNewVendor}
              disabled={createSupplier.isPending}
            >
              {createSupplier.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Simpan &amp; Pilih Vendor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
