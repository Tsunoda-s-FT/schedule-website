import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function StudentPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">学生ダッシュボード</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Link href="/student/preferences">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle>環境設定</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">環境設定へのアクセス</p>
            </CardContent>
          </Card>
        </Link>

        <Link href="/student/settings">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle>設定</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground">システム設定へのアクセス</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}