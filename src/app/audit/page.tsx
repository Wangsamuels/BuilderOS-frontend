import { CompanyRedirect } from "@/features/redirects";

/** Linked from emails and alerts. Opens the same page in the person's current company. */
export default function Page() {
  return <CompanyRedirect to="/money#ledger" />;
}
