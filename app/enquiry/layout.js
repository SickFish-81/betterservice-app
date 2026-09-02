// A page marked "use client" can't export metadata — Next needs it on the
// server to build the <head> before any JavaScript runs. A layout beside the
// page is the server half, so the page keeps its interactivity and still gets
// its own title.
export const metadata = {
  title: "Contact us",
  description: "Get in touch with Betterservice ATV, 556 Te Puke Highway, Te Puke. Phone or text 021 08327787, or send an enquiry and we'll get back to you.",
  alternates: { canonical: "/enquiry" },
};

export default function Layout({ children }) {
  return children;
}
