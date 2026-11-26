import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The role hierarchy as it is actually enforced — server-side on every HTTP
 * request and every WebSocket frame. Each role carries one of the four
 * collaborator accents as a small dot, so the table speaks the same visual
 * language as the cursors in the editor.
 */
const ROLES = [
  { name: "Owner", accent: "collab-1" },
  { name: "Editor", accent: "collab-2" },
  { name: "Commenter", accent: "collab-3" },
  { name: "Viewer", accent: "collab-4" },
];

const CAPABILITIES = [
  { name: "Open the document", allowed: [true, true, true, true] },
  { name: "Read live content", allowed: [true, true, true, true] },
  { name: "See presence and carets", allowed: [true, true, true, true] },
  { name: "Edit content", allowed: [true, true, false, false] },
  { name: "Send live updates over the socket", allowed: [true, true, false, false] },
  { name: "Restore a version", allowed: [true, true, false, false] },
  { name: "Invite people or change roles", allowed: [true, false, false, false] },
  { name: "Enable or revoke the share link", allowed: [true, false, false, false] },
  { name: "Delete (move to trash)", allowed: [true, false, false, false] },
];

export function PermissionsMatrix() {
  return (
    <div
      // A wide table on a narrow screen: focusable so it can be scrolled with
      // the keyboard, and named so the focus target is announced.
      role="region"
      aria-label="Permissions matrix"
      tabIndex={0}
      className="mockup-card overflow-x-auto rounded-2xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <caption className="sr-only">
          What each role can do in a document
        </caption>
        <thead>
          <tr className="border-b border-border">
            <th
              scope="col"
              className="px-5 py-3.5 text-left text-xs font-medium tracking-widest uppercase text-landing-muted"
            >
              Capability
            </th>
            {ROLES.map((role) => (
              <th
                key={role.name}
                scope="col"
                className="px-5 py-3.5 text-left text-xs font-medium text-foreground"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "collab-dot h-1.5 w-1.5 shrink-0 rounded-full",
                      role.accent
                    )}
                  />
                  {role.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CAPABILITIES.map((capability) => (
            <tr
              key={capability.name}
              className="border-b border-border last:border-0"
            >
              <th
                scope="row"
                className="px-5 py-3 text-left font-normal text-foreground"
              >
                {capability.name}
              </th>
              {capability.allowed.map((allowed, index) => (
                <td key={ROLES[index].name} className="px-5 py-3">
                  <span className="sr-only">
                    {allowed ? "Allowed" : "Not allowed"}
                  </span>
                  {allowed ? (
                    <Check
                      aria-hidden="true"
                      className="h-4 w-4 text-foreground"
                    />
                  ) : (
                    <span aria-hidden="true" className="text-muted-foreground">
                      —
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
