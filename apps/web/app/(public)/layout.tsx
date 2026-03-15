export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-gray-950 text-white min-h-screen">
      {children}
    </div>
  )
}
