import { redirect } from "next/navigation";

type Params = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Favorites moved into My Work (Fast Re-entry §10, §49, §50); old links land on the matching tab. */
export default async function FavoritesPage({ searchParams }: Params) {
  const params = await searchParams;
  redirect(params.tab === "recent" ? "/my-work?tab=recent" : "/my-work?tab=favorites");
}
