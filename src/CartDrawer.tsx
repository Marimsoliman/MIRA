import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CheckCircle2,
  Clock3,
  CreditCard,
  MapPin,
  Minus,
  Phone,
  Plus,
  ShoppingBag,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

type Dish = {
  number: string;
  course: string;
  name: string;
  price: number;
  image: string;
};

type CartDrawerProps = {
  open: boolean;
  dishes: Dish[];
  cart: Record<string, number>;
  onClose: () => void;
  onSetQuantity: (name: string, quantity: number) => void;
  onOrderPlaced: () => void;
};

type Step = "cart" | "delivery" | "payment" | "done";
type PaymentMethod = "cash" | "courier-card" | "online";

type DeliveryDetails = {
  name: string;
  phone: string;
  address: string;
  area: string;
  notes: string;
  time: string;
};

type OrderSnapshot = {
  number: string;
  lines: { name: string; qty: number; price: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  details: DeliveryDetails;
  method: PaymentMethod;
  etaStart: Date;
  etaEnd: Date;
};

const DELIVERY_FEE = 4.9;
const FREE_DELIVERY_OVER = 80;

const TIME_SLOTS = [
  { id: "asap", label: "As soon as possible" },
  { id: "20:00", label: "Tonight · 8:00 PM" },
  { id: "21:00", label: "Tonight · 9:00 PM" },
  { id: "22:00", label: "Tonight · 10:00 PM" },
];

const METHOD_META: Record<PaymentMethod, { icon: LucideIcon; title: string; note: string }> = {
  cash: { icon: Banknote, title: "Cash on delivery", note: "Pay in cash when the order arrives" },
  "courier-card": { icon: CreditCard, title: "Card on delivery", note: "The courier brings a card terminal" },
  online: { icon: Wallet, title: "Pay online now", note: "Secure card payment, receipt by email" },
};

const money = (value: number) => `$${Number.isInteger(value) ? value : value.toFixed(2)}`;
const clock = (date: Date) => date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const inputClass =
  "mt-2 w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 text-sm text-[#f6e8d5] outline-none transition placeholder:text-[#f6e8d5]/25 focus:border-[#e5a95e]/70 focus:bg-white/[0.07]";

export default function CartDrawer({ open, dishes, cart, onClose, onSetQuantity, onOrderPlaced }: CartDrawerProps) {
  const [step, setStep] = useState<Step>("cart");
  const [details, setDetails] = useState<DeliveryDetails>({ name: "", phone: "", address: "", area: "", notes: "", time: "asap" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [card, setCard] = useState({ number: "", expiry: "", cvc: "" });
  const [order, setOrder] = useState<OrderSnapshot | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const lines = dishes
    .filter((dish) => (cart[dish.name] ?? 0) > 0)
    .map((dish) => ({ ...dish, qty: cart[dish.name] }));
  const itemCount = lines.reduce((sum, line) => sum + line.qty, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
  const deliveryFee = subtotal === 0 || subtotal >= FREE_DELIVERY_OVER ? 0 : DELIVERY_FEE;
  const total = subtotal + deliveryFee;

  const stepIndex = step === "cart" ? 0 : step === "delivery" ? 1 : 2;

  const close = () => {
    if (step === "done") setOrder(null);
    onClose();
  };

  /* Reset the flow whenever the drawer is opened. */
  useEffect(() => {
    if (open) {
      setStep("cart");
      setErrors({});
    }
  }, [open]);

  /* Lock the page scroll while ordering. */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /* Escape closes the drawer like any respectful overlay. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* Fresh step, fresh scroll position. */
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [step]);

  const updateDetails = (key: keyof DeliveryDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const continueToPayment = () => {
    const next: Record<string, string> = {};
    if (details.name.trim().length < 2) next.name = "Tell us who the order is for";
    if (details.phone.replace(/\D/g, "").length < 7) next.phone = "A reachable phone number is required";
    if (details.address.trim().length < 4) next.address = "Where should the courier knock?";
    setErrors(next);
    if (Object.keys(next).length === 0) setStep("payment");
  };

  const formatCardNumber = (value: string) =>
    value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
  const formatExpiry = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
  };

  const placeOrder = () => {
    if (itemCount === 0) return;
    if (method === "online") {
      const next: Record<string, string> = {};
      if (card.number.replace(/\D/g, "").length < 15) next.number = "Enter a valid card number";
      if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(card.expiry)) next.expiry = "MM/YY";
      if (card.cvc.replace(/\D/g, "").length < 3) next.cvc = "3 digits";
      setErrors(next);
      if (Object.keys(next).length > 0) return;
    }

    const now = Date.now();
    const etaStart = new Date(now + (38 + Math.floor(Math.random() * 6)) * 60000);
    const etaEnd = new Date(etaStart.getTime() + 15 * 60000);
    setOrder({
      number: `AUR-${now.toString(36).toUpperCase().slice(-6)}`,
      lines: lines.map((line) => ({ name: line.name, qty: line.qty, price: line.price })),
      subtotal,
      deliveryFee,
      total,
      details: { ...details },
      method,
      etaStart,
      etaEnd,
    });
    onOrderPlaced();
    setStep("done");
  };

  const exploreMenu = () => {
    close();
    window.setTimeout(() => {
      document.getElementById("menu-journey")?.scrollIntoView({ behavior: "smooth" });
    }, 320);
  };

  const field = (key: string, label: string, input: ReactNode) => (
    <label className="block" key={key}>
      <span className="text-[0.58rem] uppercase tracking-[0.26em] text-[#f3e0c7]/50">{label}</span>
      {input}
      {errors[key] ? <span className="mt-1.5 block text-[0.62rem] tracking-wide text-[#e07a5c]">{errors[key]}</span> : null}
    </label>
  );

  return (
    <>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={close}
        className={`fixed inset-0 z-[85] bg-[#050201]/70 backdrop-blur-sm transition-opacity duration-500 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Your order"
        data-open={open}
        className="cart-panel fixed right-0 top-0 z-[90] flex h-full w-full max-w-[27rem] flex-col border-l border-[#f3dec4]/10 bg-[#0b0402] shadow-[-40px_0_120px_rgba(0,0,0,0.55)]"
      >
        {/* ── header ── */}
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-6 pb-5 pt-6">
          <div>
            <p className="text-[0.56rem] uppercase tracking-[0.34em] text-[#e5a95e]/70">Aurelia · Delivery</p>
            <h2 className="mt-2 font-serif text-3xl tracking-[-0.03em] text-[#f6e8d5]">
              {step === "done" ? "Order confirmed" : "Your order"}
            </h2>
            {step !== "done" ? (
              <div className="mt-3 flex items-center gap-2 text-[0.55rem] uppercase tracking-[0.22em]">
                {["Cart", "Delivery", "Payment"].map((label, index) => (
                  <span key={label} className="flex items-center gap-2">
                    <span className={index <= stepIndex ? "text-[#e5a95e]" : "text-white/25"}>
                      <span className={`mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full border text-[0.5rem] ${index <= stepIndex ? "border-[#e5a95e]/60" : "border-white/20"}`}>
                        {index + 1}
                      </span>
                      {label}
                    </span>
                    {index < 2 ? <span className={`h-px w-4 ${index < stepIndex ? "bg-[#e5a95e]/60" : "bg-white/15"}`} /> : null}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {step !== "cart" && step !== "done" ? (
              <button
                type="button"
                data-cursor="BACK"
                onClick={() => setStep(step === "payment" ? "delivery" : "cart")}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-[#f6e8d5]/70 transition hover:border-white/30 hover:text-white"
                aria-label="Go back"
              >
                <ArrowLeft size={15} />
              </button>
            ) : null}
            <button
              type="button"
              data-cursor="CLOSE"
              onClick={close}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-[#f6e8d5]/70 transition hover:border-white/30 hover:text-white"
              aria-label="Close cart"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── content ── */}
        <div ref={contentRef} className="flex-1 overflow-y-auto px-6 py-6">
          {step === "cart" ? (
            <div key="cart" className="cart-step">
              {lines.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-16 text-center">
                  <span className="flex h-16 w-16 items-center justify-center rounded-full border border-white/10 text-[#e5a95e]/70">
                    <ShoppingBag size={22} strokeWidth={1.5} />
                  </span>
                  <p className="mt-6 font-serif text-2xl text-[#f6e8d5]">Your cart is still empty</p>
                  <p className="mt-2 max-w-[15rem] text-sm leading-6 text-[#f6e5ce]/45">
                    Wander the tasting menu and collect the courses that call your name.
                  </p>
                  <button
                    type="button"
                    data-cursor="EXPLORE"
                    onClick={exploreMenu}
                    className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#f1ddc1] px-6 py-3 text-[0.62rem] font-extrabold uppercase tracking-[0.22em] text-[#170806] transition hover:bg-white"
                  >
                    Explore the menu <ArrowRight size={13} />
                  </button>
                </div>
              ) : (
                <ul className="flex flex-col gap-5">
                  {lines.map((line) => (
                    <li key={line.name} className="flex gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
                      <img src={line.image} alt="" className="h-16 w-16 flex-none rounded-full object-cover" style={{ maskImage: "radial-gradient(circle, #000 62%, transparent 72%)", WebkitMaskImage: "radial-gradient(circle, #000 62%, transparent 72%)" }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[0.55rem] uppercase tracking-[0.28em] text-[#ecc18c]/60">{line.course}</p>
                            <p className="mt-1 truncate font-serif text-lg leading-tight text-[#f6e8d5]">{line.name}</p>
                          </div>
                          <button
                            type="button"
                            data-cursor="REMOVE"
                            onClick={() => onSetQuantity(line.name, 0)}
                            className="text-white/30 transition hover:text-[#e07a5c]"
                            aria-label={`Remove ${line.name}`}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <div className="inline-flex items-center gap-3 rounded-full border border-white/12 px-3 py-1.5">
                            <button type="button" data-cursor="LESS" onClick={() => onSetQuantity(line.name, line.qty - 1)} className="text-[#f6e8d5]/70 transition hover:text-[#e5a95e]" aria-label={`Decrease ${line.name}`}>
                              <Minus size={13} />
                            </button>
                            <span className="min-w-4 text-center font-serif text-sm text-[#f6e8d5]">{line.qty}</span>
                            <button type="button" data-cursor="MORE" onClick={() => onSetQuantity(line.name, line.qty + 1)} className="text-[#f6e8d5]/70 transition hover:text-[#e5a95e]" aria-label={`Increase ${line.name}`}>
                              <Plus size={13} />
                            </button>
                          </div>
                          <p className="font-serif text-lg text-[#f2d1a1]">{money(line.price * line.qty)}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {step === "delivery" ? (
            <div key="delivery" className="cart-step flex flex-col gap-5">
              <p className="text-sm leading-6 text-[#f6e5ce]/50">Tell us where this world should arrive — every detail reaches the courier exactly as written.</p>
              {field("name", "Full name", (
                <input className={inputClass} placeholder="Nour El-Sherif" value={details.name} onChange={(event) => updateDetails("name", event.target.value)} autoComplete="name" />
              ))}
              {field("phone", "Phone number", (
                <input className={inputClass} placeholder="+20 100 234 5678" type="tel" inputMode="tel" value={details.phone} onChange={(event) => updateDetails("phone", event.target.value)} autoComplete="tel" />
              ))}
              {field("address", "Street address", (
                <input className={inputClass} placeholder="12 Zamalek St, Apt 4" value={details.address} onChange={(event) => updateDetails("address", event.target.value)} autoComplete="street-address" />
              ))}
              {field("area", "Area / City · optional", (
                <input className={inputClass} placeholder="Zamalek, Cairo" value={details.area} onChange={(event) => updateDetails("area", event.target.value)} />
              ))}
              {field("time", "Delivery time", (
                <select className={`${inputClass} appearance-none`} value={details.time} onChange={(event) => updateDetails("time", event.target.value)}>
                  {TIME_SLOTS.map((slot) => (
                    <option key={slot.id} value={slot.id} className="bg-[#140a05] text-[#f6e8d5]">{slot.label}</option>
                  ))}
                </select>
              ))}
              {field("notes", "Notes for the courier · optional", (
                <textarea className={`${inputClass} min-h-20 resize-none`} placeholder="Ring the bell twice, leave at the door…" value={details.notes} onChange={(event) => updateDetails("notes", event.target.value)} />
              ))}
            </div>
          ) : null}

          {step === "payment" ? (
            <div key="payment" className="cart-step flex flex-col gap-4">
              <p className="text-sm leading-6 text-[#f6e5ce]/50">Choose how you would like to settle the evening.</p>
              <div className="flex flex-col gap-3" role="radiogroup" aria-label="Payment method">
                {(Object.keys(METHOD_META) as PaymentMethod[]).map((id) => {
                  const meta = METHOD_META[id];
                  const Icon = meta.icon;
                  const active = method === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      data-cursor="PAY"
                      onClick={() => setMethod(id)}
                      className={`flex items-center gap-4 rounded-2xl border p-4 text-left transition ${active ? "border-[#e5a95e]/70 bg-[#e5a95e]/[0.08]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}
                    >
                      <span className={`flex h-10 w-10 flex-none items-center justify-center rounded-full border ${active ? "border-[#e5a95e]/60 text-[#e5a95e]" : "border-white/15 text-[#f6e8d5]/60"}`}>
                        <Icon size={17} strokeWidth={1.7} />
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-semibold text-[#f6e8d5]">{meta.title}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-[#f6e5ce]/45">{meta.note}</span>
                      </span>
                      <span className={`h-4 w-4 flex-none rounded-full border ${active ? "border-[#e5a95e] bg-[#e5a95e]" : "border-white/25"}`} />
                    </button>
                  );
                })}
              </div>

              {method === "online" ? (
                <div className="mt-1 grid grid-cols-2 gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                  <div className="col-span-2">
                    {field("number", "Card number", (
                      <input className={inputClass} placeholder="4242 4242 4242 4242" inputMode="numeric" value={card.number} onChange={(event) => setCard((c) => ({ ...c, number: formatCardNumber(event.target.value) }))} />
                    ))}
                  </div>
                  {field("expiry", "Expiry", (
                    <input className={inputClass} placeholder="MM/YY" inputMode="numeric" value={card.expiry} onChange={(event) => setCard((c) => ({ ...c, expiry: formatExpiry(event.target.value) }))} />
                  ))}
                  {field("cvc", "CVC", (
                    <input className={inputClass} placeholder="123" inputMode="numeric" value={card.cvc} onChange={(event) => setCard((c) => ({ ...c, cvc: event.target.value.replace(/\D/g, "").slice(0, 4) }))} />
                  ))}
                </div>
              ) : null}

              <div className="mt-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
                <p className="text-[0.56rem] uppercase tracking-[0.3em] text-[#f3e0c7]/45">Order recap</p>
                <div className="mt-3 flex flex-col gap-2 text-sm">
                  {lines.map((line) => (
                    <div key={line.name} className="flex items-baseline justify-between gap-3">
                      <span className="text-[#f6e5ce]/70">{line.qty} × {line.name}</span>
                      <span className="font-serif text-[#f2d1a1]">{money(line.price * line.qty)}</span>
                    </div>
                  ))}
                  <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-white/[0.07] pt-2 text-[#f6e5ce]/50">
                    <span>Delivery</span>
                    <span>{deliveryFee === 0 ? "Free" : money(deliveryFee)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {step === "done" && order ? (
            <div key="done" className="cart-step flex flex-col items-center text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#e5a95e]/15 text-[#e5a95e]">
                <CheckCircle2 size={30} strokeWidth={1.6} />
              </span>
              <p className="mt-5 font-serif text-2xl text-[#f6e8d5]">The kitchen has your order</p>
              <p className="mt-2 inline-flex items-center rounded-full border border-[#e5a95e]/40 bg-[#e5a95e]/10 px-4 py-1.5 font-mono text-xs tracking-[0.2em] text-[#eec389]">
                {order.number}
              </p>

              <div className="mt-6 w-full rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 text-left">
                <div className="flex items-center gap-3">
                  <Clock3 size={16} className="flex-none text-[#e5a95e]" />
                  <div>
                    <p className="text-sm font-semibold text-[#f6e8d5]">
                      {order.details.time === "asap"
                        ? `Arriving ${clock(order.etaStart)} – ${clock(order.etaEnd)}`
                        : `Scheduled · ${TIME_SLOTS.find((slot) => slot.id === order.details.time)?.label ?? ""}`}
                    </p>
                    <p className="text-xs text-[#f6e5ce]/45">{order.details.time === "asap" ? "Approximately 40 minutes from the flame" : "We will time the table to your hour"}</p>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 px-1">
                  {["Received", "In the kitchen", "On its way", "Delivered"].map((label, index) => (
                    <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className={`h-1.5 w-full rounded-full ${index === 0 ? "bg-[#e5a95e]" : index === 1 ? "bg-[#e5a95e]/30" : "bg-white/10"}`} />
                      <span className={`text-[0.5rem] uppercase tracking-[0.14em] ${index === 0 ? "text-[#eec389]" : "text-white/30"}`}>{label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex w-full flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4 text-left text-sm">
                <div className="flex items-start gap-3">
                  <MapPin size={15} className="mt-0.5 flex-none text-[#e5a95e]" />
                  <p className="text-[#f6e5ce]/70">
                    {order.details.address}{order.details.area ? `, ${order.details.area}` : ""}
                    {order.details.notes ? <span className="block text-xs text-[#f6e5ce]/40">“{order.details.notes}”</span> : null}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Phone size={15} className="flex-none text-[#e5a95e]" />
                  <p className="text-[#f6e5ce]/70">{order.details.phone} · {order.details.name}</p>
                </div>
                <div className="flex items-start gap-3">
                  {(() => { const Icon = METHOD_META[order.method].icon; return <Icon size={15} className="mt-0.5 flex-none text-[#e5a95e]" />; })()}
                  <p className="text-[#f6e5ce]/70">
                    {METHOD_META[order.method].title}
                    <span className="block text-xs text-[#f6e5ce]/40">
                      {order.method === "cash"
                        ? `Please prepare ${money(order.total)} in cash`
                        : order.method === "courier-card"
                          ? "A card terminal arrives with the courier"
                          : "Paid online — your receipt is on its way to your inbox"}
                    </span>
                  </p>
                </div>
                <div className="border-t border-white/[0.07] pt-3">
                  {order.lines.map((line) => (
                    <div key={line.name} className="flex items-baseline justify-between gap-3 py-0.5 text-[#f6e5ce]/60">
                      <span>{line.qty} × {line.name}</span>
                      <span className="font-serif text-[#f2d1a1]">{money(line.qty * line.price)}</span>
                    </div>
                  ))}
                  <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-white/[0.07] pt-2 text-sm">
                    <span className="uppercase tracking-[0.24em] text-[#f3e0c7]/50">Total {order.method === "online" ? "paid" : "due"}</span>
                    <span className="font-serif text-xl text-[#f6e8d5]">{money(order.total)}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── footer / call to action ── */}
        {step !== "done" ? (
          <div className="border-t border-white/[0.07] px-6 py-5">
            <div className="flex items-baseline justify-between text-sm text-[#f6e5ce]/55">
              <span>Subtotal</span>
              <span className="font-serif text-lg text-[#f6e8d5]">{money(subtotal)}</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between text-sm text-[#f6e5ce]/55">
              <span>Delivery {subtotal > 0 && deliveryFee === 0 ? <span className="text-[0.6rem] uppercase tracking-[0.18em] text-[#e5a95e]/80">· free over {money(FREE_DELIVERY_OVER)}</span> : null}</span>
              <span className="font-serif text-lg text-[#f6e8d5]">{subtotal === 0 ? "—" : deliveryFee === 0 ? "Free" : money(deliveryFee)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between border-t border-white/[0.07] pt-3">
              <span className="text-[0.62rem] uppercase tracking-[0.28em] text-[#f3e0c7]/55">Total</span>
              <span className="font-serif text-2xl text-[#eec389]">{money(total)}</span>
            </div>
            {step === "cart" ? (
              <button
                type="button"
                data-cursor="NEXT"
                disabled={lines.length === 0}
                onClick={() => setStep("delivery")}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#f1ddc1] px-6 py-3.5 text-[0.64rem] font-extrabold uppercase tracking-[0.24em] text-[#170806] transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                Continue to delivery <ArrowRight size={14} />
              </button>
            ) : step === "delivery" ? (
              <button
                type="button"
                data-cursor="NEXT"
                onClick={continueToPayment}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#f1ddc1] px-6 py-3.5 text-[0.64rem] font-extrabold uppercase tracking-[0.24em] text-[#170806] transition hover:bg-white"
              >
                Continue to payment <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                data-cursor="ORDER"
                onClick={placeOrder}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#e5a95e] px-6 py-3.5 text-[0.64rem] font-extrabold uppercase tracking-[0.24em] text-[#170806] transition hover:bg-[#f4c98d]"
              >
                Place order · {money(total)} <ArrowRight size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="border-t border-white/[0.07] px-6 py-5">
            <button
              type="button"
              data-cursor="DONE"
              onClick={close}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#f1ddc1] px-6 py-3.5 text-[0.64rem] font-extrabold uppercase tracking-[0.24em] text-[#170806] transition hover:bg-white"
            >
              Back to the experience
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
