import { Contact } from "./types";

export async function fetchGoogleContacts(accessToken: string): Promise<Contact[]> {
  try {
    const url = "https://people.googleapis.com/v1/people/me/connections?personFields=names,emailAddresses,photos&pageSize=100";
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      console.error("Failed to fetch Google connections profile:", await res.text().catch(() => ""));
      return [];
    }

    const data = await res.json();
    if (!data.connections || !Array.isArray(data.connections)) {
      return [];
    }

    const contacts: Contact[] = data.connections
      .map((entry: any) => {
        const name = entry.names?.[0]?.displayName || "Unknown Contact";
        const email = entry.emailAddresses?.[0]?.value || "";
        const photoUrl = entry.photos?.[0]?.url || "";
        return {
          resourceName: entry.resourceName || Math.random().toString(),
          name,
          email,
          photoUrl
        };
      })
      .filter((c: Contact) => c.email !== ""); // Filter out contacts without emails for calling functionality

    return contacts;
  } catch (err) {
    console.error("Error fetching Google contacts via People API:", err);
    return [];
  }
}
