// A page marked "use client" can't export metadata — Next needs it on the
// server to build the <head> before any JavaScript runs. A layout beside the
// page is the server half, so the page keeps its interactivity and still gets
// its own title.
export const metadata = {
  title: "Book a service",
  description: "Book your bike, quad or ATV in for a service or repair at Betterservice ATV, Te Puke. Tell us the machine and the problem and we'll come back to you. Pick-up available.",
  alternates: { canonical: "/book" },
};

export default function Layout({ children }) {
  return children;
}
