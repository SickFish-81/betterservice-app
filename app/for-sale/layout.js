// A page marked "use client" can't export metadata — Next needs it on the
// server to build the <head> before any JavaScript runs. A layout beside the
// page is the server half, so the page keeps its interactivity and still gets
// its own title.
export const metadata = {
  title: "Used ATVs & quads for sale",
  description: "Second-hand ATVs, quads and bikes for sale at Betterservice ATV in Te Puke, Bay of Plenty. Serviced and checked before they go out the door.",
  alternates: { canonical: "/for-sale" },
};

export default function Layout({ children }) {
  return children;
}
