export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold text-text-primary">
        Your messages live on your device, not ours.
      </h1>
      <p className="max-w-md text-base text-text-muted">
        Driftline is a local-first, real-time chat app. The server is a transport, not an archive.
      </p>
    </main>
  );
}
