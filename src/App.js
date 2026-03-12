import { useState, useMemo, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

const SCHEDULE_CONFIG = {
  3: {
    dayLabel: "水曜日",
    slots: ["10:00", "11:00", "13:00", "14:00"],
    maxPerSlot: 5,
  },
  5: {
    dayLabel: "金曜日",
    slots: ["10:00", "11:00"],
    maxPerSlot: 5,
  },
};

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatDateJP(s) {
  const d = parseDateStr(s);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${
    DAY_NAMES[d.getDay()]
  }）`;
}

export default function App() {
  const isAdmin =
    new URLSearchParams(window.location.search).get("admin") === "true";
  const [view, setView] = useState(isAdmin ? "admin" : "client");
  const [myEmail, setMyEmail] = useState("");
  const [myEmailInput, setMyEmailInput] = useState("");
  const [myCancelTarget, setMyCancelTarget] = useState(null);
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    // 初回データ取得
    const fetchBookings = async () => {
      const { data } = await supabase
        .from("bookings")
        .select("*")
        .eq("status", "confirmed");
      if (data) setBookings(data);
    };
    fetchBookings();

    // リアルタイム監視を設定
    const channel = supabase
      .channel("bookings-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            // 新規予約が入ったら追加
            if (payload.new.status === "confirmed") {
              setBookings((prev) => [...prev, payload.new]);
            }
          } else if (payload.eventType === "UPDATE") {
            // キャンセルなど更新があったら反映
            setBookings((prev) =>
              prev.map((b) => (b.id === payload.new.id ? payload.new : b))
            );
          }
        }
      )
      .subscribe();

    // コンポーネント終了時に監視を解除
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const [step, setStep] = useState(1);
  const [selectedDate, setSelectedDate] = useState(null);
  const [selectedTime, setSelectedTime] = useState(null);
  const [form, setForm] = useState({ name: "", email: "" });

  const today = new Date();
  const [calYM, setCalYM] = useState({
    year: today.getFullYear(),
    month: today.getMonth(),
  });

  const [toast, setToast] = useState(null);
  const showToast = (msg, color = "#5C8A6E") => {
    setToast({ msg, color });
    setTimeout(() => setToast(null), 3000);
  };

  const [cancelTarget, setCancelTarget] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const bookingMap = useMemo(() => {
    const map = {};
    bookings.forEach((b) => {
      if (b.status !== "confirmed") return;
      const key = `${b.date}_${b.time}`;
      map[key] = (map[key] || 0) + 1;
    });
    return map;
  }, [bookings]);

  const getCount = (date, time) => bookingMap[`${date}_${time}`] || 0;

  const { firstDow, daysTotal } = useMemo(() => {
    const { year, month } = calYM;
    return {
      firstDow: new Date(year, month, 1).getDay(),
      daysTotal: new Date(year, month + 1, 0).getDate(),
    };
  }, [calYM]);

  const isAvailableDate = (day) => {
    const d = new Date(calYM.year, calYM.month, day);
    const todayMidnight = new Date(today);
    todayMidnight.setHours(0, 0, 0, 0);
    if (d < todayMidnight) return false;
    return d.getDay() in SCHEDULE_CONFIG;
  };

  const getDayConfig = (dateS) => {
    const dow = parseDateStr(dateS).getDay();
    return SCHEDULE_CONFIG[dow] || null;
  };

  const handleBook = async () => {
    // ダブルクリック防止
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const config = getDayConfig(selectedDate);
      const { data, error } = await supabase.rpc("book_slot", {
        p_date: selectedDate,
        p_time: selectedTime,
        p_name: form.name,
        p_email: form.email,
        p_max_per_slot: config.maxPerSlot,
      });

      if (error) {
        showToast("予約に失敗しました", "#C87070");
        return;
      }

      if (data.error === "full") {
        showToast("⚠️ 満席のため予約できませんでした", "#C87070");
        // 最新の予約状況を再取得
        const { data: latest } = await supabase
          .from("bookings")
          .select("*")
          .eq("status", "confirmed");
        if (latest) setBookings(latest);
        return;
      }

      if (data.error === "duplicate") {
        showToast("⚠️ この日時はすでに予約済みです", "#C87070");
        return;
      }

      setBookings((p) => [...p, data]);
      setStep(3);
      showToast("✓ 予約が完了しました！");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async (id) => {
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", id);
    if (error) {
      showToast("キャンセルに失敗しました", "#C87070");
      return;
    }
    setBookings((p) =>
      p.map((b) => (b.id === id ? { ...b, status: "cancelled" } : b))
    );
    setCancelTarget(null);
    showToast("予約をキャンセルしました。", "#A07060");
  };

  const resetFlow = () => {
    setStep(1);
    setSelectedDate(null);
    setSelectedTime(null);
    setForm({ name: "", email: "" });
  };

  const todayS = dateStr(today);

  const upcomingBookings = useMemo(
    () =>
      bookings
        .filter((b) => b.status === "confirmed" && b.date >= todayS)
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
        ),
    [bookings, todayS]
  );

  const config = selectedDate ? getDayConfig(selectedDate) : null;

  const myBookings = useMemo(
    () =>
      bookings
        .filter(
          (b) =>
            b.email === myEmail && b.status === "confirmed" && b.date >= todayS
        )
        .sort(
          (a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)
        ),
    [bookings, myEmail, todayS]
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#F2EEE8",
        fontFamily: "'Hiragino Sans', 'Noto Sans JP', sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant:ital,wght@0,300;0,400;0,500;1,300&family=Noto+Sans+JP:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --sage: #5C8A6E;
          --sage-light: #EAF2EE;
          --sage-dark: #3E6B52;
          --warm: #8A6C5C;
          --text: #2A2A2A;
          --muted: #888;
          --bg: #F2EEE8;
          --surface: #FDFCFA;
          --border: #E0DAD2;
        }
        .serif { font-family: 'Cormorant', Georgia, serif; }
        .sans { font-family: 'Noto Sans JP', sans-serif; }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes slideRight { from { opacity:0; transform:translateX(-8px); } to { opacity:1; transform:translateX(0); } }
        @keyframes toastIn { from { opacity:0; transform:translateY(-12px) scale(0.96); } to { opacity:1; transform:translateY(0) scale(1); } }
        .fade-up { animation: fadeUp 0.4s ease forwards; }
        .slide-right { animation: slideRight 0.3s ease forwards; }
        .nav-tab { padding: 8px 20px; background: none; border: none; cursor: pointer; font-family: 'Noto Sans JP', sans-serif; font-size: 13px; color: var(--muted); letter-spacing: 0.08em; border-bottom: 2px solid transparent; transition: all 0.2s; }
        .nav-tab.active { color: var(--sage); border-bottom-color: var(--sage); font-weight: 500; }
        .cal-day { width: 38px; height: 38px; border: none; background: none; cursor: pointer; border-radius: 50%; font-family: 'Noto Sans JP', sans-serif; font-size: 13px; color: var(--text); transition: all 0.15s; position: relative; display: flex; align-items: center; justify-content: center; margin: 0 auto; }
        .cal-day:hover:not(:disabled) { background: var(--sage-light); }
        .cal-day.is-available { color: var(--sage); font-weight: 500; }
        .cal-day.is-selected { background: var(--sage) !important; color: white !important; }
        .cal-day:disabled { color: #CCC; cursor: default; }
        .cal-day.is-available::after { content: ''; position: absolute; bottom: 5px; left: 50%; transform: translateX(-50%); width: 4px; height: 4px; border-radius: 50%; background: var(--sage); opacity: 0.5; }
        .cal-day.is-selected::after { background: white; opacity: 0.7; }
        .slot-btn { padding: 14px 12px; border: 1.5px solid var(--border); background: var(--surface); cursor: pointer; transition: all 0.2s; text-align: center; width: 100%; }
        .slot-btn:hover:not(.full):not(.selected) { border-color: var(--sage); background: var(--sage-light); }
        .slot-btn.selected { border-color: var(--sage); background: var(--sage-light); }
        .slot-btn.full { background: #F5F3F0; cursor: not-allowed; border-color: var(--border); }
        .inp { width: 100%; padding: 13px 16px; border: 1.5px solid var(--border); background: var(--surface); font-family: 'Noto Sans JP', sans-serif; font-size: 14px; color: var(--text); outline: none; transition: border-color 0.2s; }
        .inp:focus { border-color: var(--sage); }
        .btn-p { background: var(--sage); color: white; border: none; padding: 14px 28px; font-family: 'Noto Sans JP', sans-serif; font-size: 14px; cursor: pointer; transition: all 0.2s; letter-spacing: 0.05em; }
        .btn-p:hover { background: var(--sage-dark); }
        .btn-p:disabled { background: #C5D5CC; cursor: not-allowed; }
        .btn-o { background: transparent; color: var(--sage); border: 1.5px solid var(--sage); padding: 12px 24px; font-family: 'Noto Sans JP', sans-serif; font-size: 14px; cursor: pointer; transition: all 0.2s; }
        .btn-o:hover { background: var(--sage-light); }
        .btn-danger { background: #B85C5C; color: white; border: none; padding: 13px 24px; font-family: 'Noto Sans JP', sans-serif; font-size: 14px; cursor: pointer; transition: background 0.2s; }
        .btn-danger:hover { background: #9E4444; }
        .card { background: var(--surface); box-shadow: 0 2px 16px rgba(0,0,0,0.05); }
        .progress-track { height: 2px; background: var(--border); }
        .progress-fill { height: 2px; background: var(--sage); transition: width 0.4s ease; }
        .cap-bar { height: 4px; background: #E8E2DA; border-radius: 2px; overflow: hidden; }
        .cap-fill { height: 100%; border-radius: 2px; transition: width 0.3s; }
        .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 13px 24px; background: white; border-radius: 2px; box-shadow: 0 6px 32px rgba(0,0,0,0.12); font-family: 'Noto Sans JP', sans-serif; font-size: 13px; z-index: 9999; animation: toastIn 0.3s ease; white-space: nowrap; border-top: 3px solid var(--sage); }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px; backdrop-filter: blur(2px); }
        .modal { background: var(--surface); padding: 36px; max-width: 400px; width: 100%; animation: fadeUp 0.25s ease; }
        .brow { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); }
        .brow:last-child { border-bottom: none; }
        .week-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .two-col-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .pc-nav { display: flex; }
        .hamburger { display: none !important; }
        @media (max-width: 640px) {
          .two-col-grid { grid-template-columns: 1fr !important; }
          .week-grid { grid-template-columns: 1fr !important; }
          .cal-day { width: 34px; height: 34px; font-size: 12px; }
          .slot-btn { padding: 12px 10px; }
          .modal { padding: 24px !important; }
          .brow { flex-wrap: wrap; }
          header .serif { font-size: 17px !important; }
          header .sans { display: none; }
          .nav-tab { padding: 6px 8px; font-size: 11px; letter-spacing: 0; }
          .pc-nav { display: none !important; }
          .hamburger { display: flex !important; }
        }
      `}</style>

      {/* Toast */}
      {toast && (
        <div className="toast sans" style={{ borderTopColor: toast.color }}>
          {toast.msg}
        </div>
      )}

      {/* 管理者キャンセルModal */}
      {cancelTarget && (
        <div className="overlay" onClick={() => setCancelTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p
              className="serif"
              style={{ fontSize: 24, marginBottom: 8, color: "var(--text)" }}
            >
              予約のキャンセル
            </p>
            <p
              className="sans"
              style={{
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.9,
                marginBottom: 28,
              }}
            >
              {formatDateJP(cancelTarget.date)} {cancelTarget.time}〜<br />
              <strong style={{ color: "var(--text)" }}>
                {cancelTarget.name}
              </strong>{" "}
              様の予約をキャンセルしますか？
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn-o sans"
                style={{ flex: 1 }}
                onClick={() => setCancelTarget(null)}
              >
                戻る
              </button>
              <button
                className="btn-danger sans"
                style={{ flex: 1 }}
                onClick={() => handleCancel(cancelTarget.id)}
              >
                キャンセルする
              </button>
            </div>
          </div>
        </div>
      )}

      {/* マイページキャンセルModal */}
      {myCancelTarget && (
        <div className="overlay" onClick={() => setMyCancelTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <p
              className="serif"
              style={{ fontSize: 24, marginBottom: 8, color: "var(--text)" }}
            >
              予約のキャンセル
            </p>
            <p
              className="sans"
              style={{
                fontSize: 13,
                color: "var(--muted)",
                lineHeight: 1.9,
                marginBottom: 28,
              }}
            >
              {formatDateJP(myCancelTarget.date)} {myCancelTarget.time}〜<br />
              この予約をキャンセルしますか？
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="btn-o sans"
                style={{ flex: 1 }}
                onClick={() => setMyCancelTarget(null)}
              >
                戻る
              </button>
              <button
                className="btn-danger sans"
                style={{ flex: 1 }}
                onClick={async () => {
                  const { error } = await supabase
                    .from("bookings")
                    .update({ status: "cancelled" })
                    .eq("id", myCancelTarget.id);
                  if (error) {
                    showToast("キャンセルに失敗しました", "#C87070");
                    return;
                  }
                  setBookings((p) =>
                    p.map((b) =>
                      b.id === myCancelTarget.id
                        ? { ...b, status: "cancelled" }
                        : b
                    )
                  );
                  setMyCancelTarget(null);
                  showToast("予約をキャンセルしました。", "#A07060");
                }}
              >
                キャンセルする
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header
        style={{
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          position: "relative",
        }}
      >
        <div
          style={{
            maxWidth: 860,
            margin: "0 auto",
            padding: "0 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 60,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span
              className="serif"
              style={{
                fontSize: 22,
                letterSpacing: "0.06em",
                color: "var(--text)",
              }}
            >
              Pilates Studio
            </span>
            <span
              className="sans"
              style={{
                fontSize: 10,
                color: "var(--muted)",
                letterSpacing: "0.15em",
                textTransform: "uppercase",
              }}
            >
              Reservation
            </span>
          </div>

          {/* PC用タブ */}
          <nav className="pc-nav" style={{ display: "flex" }}>
            <button
              className={`nav-tab sans ${view === "client" ? "active" : ""}`}
              onClick={() => {
                setView("client");
                resetFlow();
              }}
            >
              予約する
            </button>
            <button
              className={`nav-tab sans ${view === "mypage" ? "active" : ""}`}
              onClick={() => setView("mypage")}
            >
              予約確認
            </button>
            {isAdmin && (
              <button
                className={`nav-tab sans ${view === "admin" ? "active" : ""}`}
                onClick={() => setView("admin")}
              >
                管理画面
              </button>
            )}
          </nav>

          {/* スマホ用ハンバーガーボタン */}
          <button
            className="hamburger"
            onClick={() => setMenuOpen((p) => !p)}
            style={{
              display: "none",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 8,
              flexDirection: "column",
              gap: 5,
            }}
          >
            <span
              style={{
                display: "block",
                width: 22,
                height: 2,
                background: menuOpen ? "var(--sage)" : "var(--text)",
                transition: "all 0.2s",
                transform: menuOpen
                  ? "rotate(45deg) translate(5px, 5px)"
                  : "none",
              }}
            />
            <span
              style={{
                display: "block",
                width: 22,
                height: 2,
                background: "var(--text)",
                transition: "all 0.2s",
                opacity: menuOpen ? 0 : 1,
              }}
            />
            <span
              style={{
                display: "block",
                width: 22,
                height: 2,
                background: menuOpen ? "var(--sage)" : "var(--text)",
                transition: "all 0.2s",
                transform: menuOpen
                  ? "rotate(-45deg) translate(5px, -5px)"
                  : "none",
              }}
            />
          </button>
        </div>

        {/* スマホ用ドロップダウンメニュー */}
        {menuOpen && (
          <div
            className="mobile-menu"
            style={{
              background: "var(--surface)",
              borderTop: "1px solid var(--border)",
              padding: "8px 0",
            }}
          >
            {[
              {
                label: "予約する",
                v: "client",
                action: () => {
                  setView("client");
                  resetFlow();
                  setMenuOpen(false);
                },
              },
              {
                label: "予約確認",
                v: "mypage",
                action: () => {
                  setView("mypage");
                  setMenuOpen(false);
                },
              },
              ...(isAdmin
                ? [
                    {
                      label: "管理画面",
                      v: "admin",
                      action: () => {
                        setView("admin");
                        setMenuOpen(false);
                      },
                    },
                  ]
                : []),
            ].map((item) => (
              <button
                key={item.v}
                onClick={item.action}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "14px 24px",
                  background: view === item.v ? "var(--sage-light)" : "none",
                  border: "none",
                  textAlign: "left",
                  fontFamily: "'Noto Sans JP', sans-serif",
                  fontSize: 14,
                  color: view === item.v ? "var(--sage)" : "var(--text)",
                  cursor: "pointer",
                  fontWeight: view === item.v ? 500 : 300,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {view === "client" && step < 3 && (
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{ width: step === 1 ? "50%" : "90%" }}
            />
          </div>
        )}
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "32px 20px" }}>
        {/* ========== 予約フロー ========== */}
        {view === "client" && (
          <>
            {step === 1 && (
              <div className="fade-up two-col-grid">
                {/* Calendar */}
                <div className="card" style={{ padding: 24 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 20,
                    }}
                  >
                    <button
                      onClick={() =>
                        setCalYM((p) => {
                          const d = new Date(p.year, p.month - 1);
                          return { year: d.getFullYear(), month: d.getMonth() };
                        })
                      }
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: 20,
                        lineHeight: 1,
                        padding: "4px 10px",
                      }}
                    >
                      ‹
                    </button>
                    <span
                      className="serif"
                      style={{ fontSize: 20, color: "var(--text)" }}
                    >
                      {calYM.year}年 {calYM.month + 1}月
                    </span>
                    <button
                      onClick={() =>
                        setCalYM((p) => {
                          const d = new Date(p.year, p.month + 1);
                          return { year: d.getFullYear(), month: d.getMonth() };
                        })
                      }
                      style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--muted)",
                        fontSize: 20,
                        lineHeight: 1,
                        padding: "4px 10px",
                      }}
                    >
                      ›
                    </button>
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      marginBottom: 6,
                    }}
                  >
                    {DAY_NAMES.map((d, i) => (
                      <div
                        key={d}
                        className="sans"
                        style={{
                          textAlign: "center",
                          fontSize: 11,
                          color:
                            i === 0
                              ? "#C88"
                              : i === 6
                              ? "#88C"
                              : "var(--muted)",
                          padding: "4px 0",
                          fontWeight: 500,
                        }}
                      >
                        {d}
                      </div>
                    ))}
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      gap: "4px 0",
                    }}
                  >
                    {Array(firstDow)
                      .fill(null)
                      .map((_, i) => (
                        <div key={`e${i}`} />
                      ))}
                    {Array(daysTotal)
                      .fill(null)
                      .map((_, i) => {
                        const day = i + 1;
                        const ds = `${calYM.year}-${String(
                          calYM.month + 1
                        ).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        const avail = isAvailableDate(day);
                        const selected = selectedDate === ds;
                        const dow = new Date(
                          calYM.year,
                          calYM.month,
                          day
                        ).getDay();
                        return (
                          <button
                            key={day}
                            className={`cal-day sans ${
                              avail ? "is-available" : ""
                            } ${selected ? "is-selected" : ""}`}
                            disabled={!avail}
                            style={{
                              color: !avail
                                ? dow === 0
                                  ? "#DDB"
                                  : undefined
                                : undefined,
                            }}
                            onClick={() => {
                              setSelectedDate(ds);
                              setSelectedTime(null);
                            }}
                          >
                            {day}
                          </button>
                        );
                      })}
                  </div>
                  <div
                    style={{
                      marginTop: 16,
                      padding: "12px 14px",
                      background: "var(--sage-light)",
                      display: "flex",
                      gap: 20,
                      flexWrap: "wrap",
                    }}
                  >
                    {Object.entries(SCHEDULE_CONFIG).map(([dow, cfg]) => (
                      <div
                        key={dow}
                        className="sans"
                        style={{ fontSize: 11, color: "var(--sage)" }}
                      >
                        <span style={{ fontWeight: 500 }}>{cfg.dayLabel}</span>
                        <span style={{ color: "var(--muted)", marginLeft: 4 }}>
                          {cfg.slots.length}枠 / 各{cfg.maxPerSlot}名
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Time Slots */}
                <div className="card" style={{ padding: 24 }}>
                  {!selectedDate ? (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                        gap: 12,
                        opacity: 0.4,
                      }}
                    >
                      <div style={{ fontSize: 40 }}>📅</div>
                      <p
                        className="sans"
                        style={{
                          fontSize: 13,
                          color: "var(--muted)",
                          textAlign: "center",
                        }}
                      >
                        カレンダーから
                        <br />
                        日付を選んでください
                      </p>
                      <p
                        className="sans"
                        style={{ fontSize: 11, color: "var(--muted)" }}
                      >
                        水曜・金曜のみ予約可能
                      </p>
                    </div>
                  ) : (
                    <div className="slide-right">
                      <p
                        className="serif"
                        style={{ fontSize: 20, marginBottom: 4 }}
                      >
                        {formatDateJP(selectedDate)}
                      </p>
                      <p
                        className="sans"
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          marginBottom: 20,
                        }}
                      >
                        時間帯を選択してください
                      </p>
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        {config?.slots.map((t) => {
                          const count = getCount(selectedDate, t);
                          const max = config.maxPerSlot;
                          const remaining = max - count;
                          const full = remaining <= 0;
                          const selected = selectedTime === t;
                          const pct = Math.min(100, (count / max) * 100);
                          const fillColor =
                            pct < 60
                              ? "var(--sage)"
                              : pct < 90
                              ? "#C8A85A"
                              : "#C87070";
                          return (
                            <button
                              key={t}
                              className={`slot-btn sans ${
                                full ? "full" : selected ? "selected" : ""
                              }`}
                              onClick={() => !full && setSelectedTime(t)}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  marginBottom: 8,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 16,
                                    fontWeight: 500,
                                    color: full
                                      ? "#BBB"
                                      : selected
                                      ? "var(--sage-dark)"
                                      : "var(--text)",
                                    fontFamily: "'Cormorant', serif",
                                  }}
                                >
                                  {t}〜
                                </span>
                                <span
                                  className="sans"
                                  style={{
                                    fontSize: 11,
                                    color: full
                                      ? "#BBB"
                                      : remaining <= 2
                                      ? "#C87070"
                                      : "var(--muted)",
                                  }}
                                >
                                  {full ? "満席" : `残り ${remaining}名`}
                                </span>
                              </div>
                              <div className="cap-bar">
                                <div
                                  className="cap-fill"
                                  style={{
                                    width: `${pct}%`,
                                    background: full ? "#DDD" : fillColor,
                                  }}
                                />
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  justifyContent: "flex-end",
                                  marginTop: 4,
                                }}
                              >
                                <span
                                  className="sans"
                                  style={{ fontSize: 10, color: "#AAA" }}
                                >
                                  {count} / {max}名
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {selectedTime && (
                        <button
                          className="btn-p sans"
                          style={{ width: "100%", marginTop: 20 }}
                          onClick={() => setStep(2)}
                        >
                          次へ進む →
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div
                className="fade-up card"
                style={{ maxWidth: 460, margin: "0 auto", padding: 36 }}
              >
                <p className="serif" style={{ fontSize: 26, marginBottom: 4 }}>
                  お客様情報の入力
                </p>
                <p
                  className="sans"
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    marginBottom: 28,
                  }}
                >
                  {formatDateJP(selectedDate)}　{selectedTime}〜
                </p>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 18,
                    marginBottom: 28,
                  }}
                >
                  <div>
                    <label
                      className="sans"
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        display: "block",
                        marginBottom: 7,
                        letterSpacing: "0.05em",
                      }}
                    >
                      お名前 *
                    </label>
                    <input
                      className="inp sans"
                      placeholder="山田 花子"
                      value={form.name}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, name: e.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label
                      className="sans"
                      style={{
                        fontSize: 12,
                        color: "var(--muted)",
                        display: "block",
                        marginBottom: 7,
                        letterSpacing: "0.05em",
                      }}
                    >
                      メールアドレス *
                    </label>
                    <input
                      className="inp sans"
                      type="email"
                      placeholder="hanako@example.com"
                      value={form.email}
                      onChange={(e) =>
                        setForm((p) => ({ ...p, email: e.target.value }))
                      }
                    />
                  </div>
                </div>
                <div
                  style={{
                    background: "var(--sage-light)",
                    padding: "16px 20px",
                    marginBottom: 24,
                  }}
                >
                  <p
                    className="sans"
                    style={{
                      fontSize: 11,
                      color: "var(--sage)",
                      letterSpacing: "0.1em",
                      marginBottom: 10,
                      fontWeight: 500,
                    }}
                  >
                    予約内容の確認
                  </p>
                  {[
                    [
                      "日時",
                      `${formatDateJP(selectedDate)}　${selectedTime}〜`,
                    ],
                    [
                      "残席",
                      `あと ${
                        config?.maxPerSlot -
                        getCount(selectedDate, selectedTime)
                      } 名`,
                    ],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      style={{ display: "flex", gap: 16, marginBottom: 6 }}
                    >
                      <span
                        className="sans"
                        style={{
                          fontSize: 12,
                          color: "var(--muted)",
                          minWidth: 40,
                        }}
                      >
                        {k}
                      </span>
                      <span
                        className="sans"
                        style={{
                          fontSize: 12,
                          color: "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 12 }}>
                  <button className="btn-o sans" onClick={() => setStep(1)}>
                    ← 戻る
                  </button>
                  <button
                    className="btn-p sans"
                    style={{ flex: 1 }}
                    disabled={!form.name || !form.email || isSubmitting}
                    onClick={handleBook}
                  >
                    {isSubmitting ? "送信中..." : "予約を確定する"}
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div
                className="fade-up card"
                style={{
                  maxWidth: 440,
                  margin: "0 auto",
                  padding: "52px 36px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "var(--sage-light)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 24px",
                    fontSize: 28,
                  }}
                >
                  ✓
                </div>
                <p
                  className="serif"
                  style={{
                    fontSize: 30,
                    color: "var(--sage)",
                    marginBottom: 8,
                  }}
                >
                  予約完了
                </p>
                <p
                  className="sans"
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    lineHeight: 1.9,
                    marginBottom: 32,
                  }}
                >
                  ご予約ありがとうございます。
                  <br />
                  {form.email} に確認メールをお送りしました。
                </p>
                <div
                  style={{
                    background: "var(--bg)",
                    padding: "20px 24px",
                    marginBottom: 24,
                    textAlign: "left",
                  }}
                >
                  {[
                    [
                      "日時",
                      `${formatDateJP(selectedDate)}　${selectedTime}〜`,
                    ],
                    ["お名前", `${form.name} 様`],
                  ].map(([k, v]) => (
                    <div
                      key={k}
                      style={{ display: "flex", gap: 16, marginBottom: 8 }}
                    >
                      <span
                        className="sans"
                        style={{
                          fontSize: 13,
                          color: "var(--muted)",
                          minWidth: 48,
                        }}
                      >
                        {k}
                      </span>
                      <span
                        className="sans"
                        style={{
                          fontSize: 13,
                          color: "var(--text)",
                          fontWeight: 500,
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    background: "var(--sage-light)",
                    padding: "16px 20px",
                    marginBottom: 24,
                    textAlign: "left",
                  }}
                >
                  <p
                    className="sans"
                    style={{
                      fontSize: 12,
                      color: "var(--sage)",
                      fontWeight: 500,
                      marginBottom: 6,
                    }}
                  >
                    📋 予約の確認・キャンセルはこちら
                  </p>
                  <p
                    className="sans"
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      lineHeight: 1.8,
                    }}
                  >
                    上部メニューの「予約確認」タブから
                    <br />
                    メールアドレスを入力して確認できます。
                  </p>
                </div>
                <button className="btn-o sans" onClick={resetFlow}>
                  別の予約をする
                </button>
              </div>
            )}
          </>
        )}

        {/* ========== マイページ ========== */}
        {view === "mypage" && (
          <div className="fade-up">
            <div
              className="card"
              style={{ maxWidth: 500, margin: "0 auto", padding: 32 }}
            >
              <p className="serif" style={{ fontSize: 26, marginBottom: 6 }}>
                予約の確認・キャンセル
              </p>
              <p
                className="sans"
                style={{
                  fontSize: 13,
                  color: "var(--muted)",
                  marginBottom: 24,
                  lineHeight: 1.8,
                }}
              >
                ご予約時に入力したメールアドレスを入力してください。
              </p>
              <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                <input
                  className="inp sans"
                  type="email"
                  placeholder="hanako@example.com"
                  value={myEmailInput}
                  onChange={(e) => setMyEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const trimmed = myEmailInput.trim().toLowerCase();
                      setMyEmail(trimmed);
                      setMyEmailInput(trimmed);
                    }
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn-p sans"
                  onClick={() => {
                    const trimmed = myEmailInput.trim().toLowerCase();
                    setMyEmail(trimmed);
                    setMyEmailInput(trimmed);
                  }}
                  disabled={!myEmailInput}
                >
                  検索
                </button>
              </div>
              {myEmail && (
                <div className="slide-right" style={{ marginTop: 24 }}>
                  <p
                    className="sans"
                    style={{
                      fontSize: 12,
                      color: "var(--muted)",
                      marginBottom: 16,
                    }}
                  >
                    <strong style={{ color: "var(--text)" }}>{myEmail}</strong>{" "}
                    の今後の予約
                  </p>
                  {myBookings.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "32px 0",
                        color: "var(--muted)",
                      }}
                    >
                      <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
                      <p className="sans" style={{ fontSize: 13 }}>
                        予約が見つかりませんでした
                      </p>
                      <p
                        className="sans"
                        style={{ fontSize: 12, marginTop: 6 }}
                      >
                        メールアドレスをご確認ください
                      </p>
                    </div>
                  ) : (
                    myBookings.map((b) => (
                      <div key={b.id} className="brow">
                        <div style={{ flex: 1 }}>
                          <p
                            className="sans"
                            style={{
                              fontSize: 14,
                              fontWeight: 500,
                              marginBottom: 2,
                            }}
                          >
                            {formatDateJP(b.date)}
                          </p>
                          <p
                            className="sans"
                            style={{ fontSize: 12, color: "var(--muted)" }}
                          >
                            {b.time}〜　{b.name} 様
                          </p>
                        </div>
                        <button
                          className="sans"
                          onClick={() => setMyCancelTarget(b)}
                          style={{
                            background: "none",
                            border: "1px solid var(--border)",
                            padding: "6px 14px",
                            cursor: "pointer",
                            fontSize: 12,
                            color: "var(--muted)",
                            transition: "all 0.2s",
                            flexShrink: 0,
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.borderColor = "#B85C5C";
                            e.currentTarget.style.color = "#B85C5C";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.color = "var(--muted)";
                          }}
                        >
                          キャンセル
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========== 管理画面 ========== */}
        {view === "admin" && (
          <div className="fade-up">
            <div className="week-grid" style={{ marginBottom: 20 }}>
              {Object.entries(SCHEDULE_CONFIG).map(([dow, cfg]) => {
                const diff = (Number(dow) - today.getDay() + 7) % 7 || 7;
                const nextDate = new Date(today);
                nextDate.setDate(today.getDate() + diff);
                const ds = dateStr(nextDate);
                return (
                  <div key={dow} className="card" style={{ padding: 20 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 16,
                      }}
                    >
                      <div>
                        <span
                          className="serif"
                          style={{ fontSize: 22, color: "var(--text)" }}
                        >
                          {cfg.dayLabel}
                        </span>
                        <p
                          className="sans"
                          style={{
                            fontSize: 11,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          {formatDateJP(ds)}（次回）
                        </p>
                      </div>
                      <span
                        className="sans"
                        style={{
                          fontSize: 11,
                          background: "var(--sage-light)",
                          color: "var(--sage)",
                          padding: "4px 10px",
                          fontWeight: 500,
                        }}
                      >
                        {cfg.slots.length}枠 / 各{cfg.maxPerSlot}名
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {cfg.slots.map((t) => {
                        const cnt = getCount(ds, t);
                        const pct = Math.min(100, (cnt / cfg.maxPerSlot) * 100);
                        const fillColor =
                          pct === 0
                            ? "var(--border)"
                            : pct < 60
                            ? "var(--sage)"
                            : pct < 90
                            ? "#C8A85A"
                            : "#C87070";
                        return (
                          <div key={t}>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: 4,
                              }}
                            >
                              <span
                                className="sans"
                                style={{ fontSize: 12, color: "var(--text)" }}
                              >
                                {t}
                              </span>
                              <span
                                className="sans"
                                style={{ fontSize: 11, color: "var(--muted)" }}
                              >
                                {cnt} / {cfg.maxPerSlot}名
                              </span>
                            </div>
                            <div className="cap-bar">
                              <div
                                className="cap-fill"
                                style={{
                                  width: `${pct}%`,
                                  background: fillColor,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="card" style={{ padding: 28 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <p className="serif" style={{ fontSize: 22 }}>
                  予約一覧
                </p>
                <span
                  className="sans"
                  style={{ fontSize: 12, color: "var(--muted)" }}
                >
                  今後の予約 {upcomingBookings.length} 件
                </span>
              </div>
              {upcomingBookings.length === 0 ? (
                <p
                  className="sans"
                  style={{
                    color: "var(--muted)",
                    textAlign: "center",
                    padding: "32px 0",
                    fontSize: 13,
                  }}
                >
                  予約はありません
                </p>
              ) : (
                upcomingBookings.map((b) => {
                  const dow = parseDateStr(b.date).getDay();
                  const cfg = SCHEDULE_CONFIG[dow];
                  const cnt = getCount(b.date, b.time);
                  return (
                    <div key={b.id} className="brow">
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: dow === 3 ? "var(--sage)" : "var(--warm)",
                          flexShrink: 0,
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <p
                          className="sans"
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            marginBottom: 2,
                          }}
                        >
                          {b.name}
                        </p>
                        <p
                          className="sans"
                          style={{ fontSize: 12, color: "var(--muted)" }}
                        >
                          {formatDateJP(b.date)}　{b.time}〜
                          <span
                            style={{
                              marginLeft: 10,
                              color:
                                cnt >= cfg?.maxPerSlot
                                  ? "#C87070"
                                  : "var(--muted)",
                            }}
                          >
                            同枠 {cnt} / {cfg?.maxPerSlot}名
                          </span>
                        </p>
                      </div>
                      <button
                        className="sans"
                        onClick={() => setCancelTarget(b)}
                        style={{
                          background: "none",
                          border: "1px solid var(--border)",
                          padding: "6px 14px",
                          cursor: "pointer",
                          fontSize: 12,
                          color: "var(--muted)",
                          transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "#B85C5C";
                          e.currentTarget.style.color = "#B85C5C";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border)";
                          e.currentTarget.style.color = "var(--muted)";
                        }}
                      >
                        キャンセル
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="card" style={{ padding: 24, marginTop: 16 }}>
              <p className="serif" style={{ fontSize: 18, marginBottom: 6 }}>
                予約URLの共有
              </p>
              <p
                className="sans"
                style={{
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 16,
                }}
              >
                このURLをQRコード化してSNS・チラシに掲載しましょう。
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    flex: 1,
                    minWidth: 200,
                    background: "var(--bg)",
                    padding: "11px 16px",
                    border: "1px dashed var(--border)",
                  }}
                >
                  <span
                    className="sans"
                    style={{ fontSize: 12, color: "var(--muted)" }}
                  >
                    https://gy-mproject-f-e.vercel.app/
                  </span>
                </div>
                <button
                  className="btn-p sans"
                  onClick={() => {
                    const url = window.location.origin;
                    navigator.clipboard
                      .writeText(url)
                      .then(() => showToast("✓ URLをコピーしました"))
                      .catch(() =>
                        showToast("コピーに失敗しました", "#C87070")
                      );
                  }}
                >
                  URLをコピー
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
