"use client";

import { useState } from "react";
import { GradeTable } from "@/components/grade/grade-table";
import { GradeFormDialog } from "@/components/grade/grade-form-dialog";
import { Tabs, TabsContent } from "@/components/ui/tabs";

export function GradeTabs() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  return (
    <Tabs defaultValue="list" className="w-full">
      <TabsContent value="list" className="mt-0">
        <GradeTable />
      </TabsContent>

      <TabsContent value="create" className="mt-0">
        {/* This tab just opens the dialog */}
      </TabsContent>

      <GradeFormDialog
        open={isCreateDialogOpen}
        onOpenChange={(open) => {
          setIsCreateDialogOpen(open);
        }}
      />
    </Tabs>
  );
}
