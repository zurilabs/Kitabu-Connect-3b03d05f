import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SchoolCombobox } from "@/components/ui/school-combobox";
import { useActiveChild, type Child } from "@/contexts/ActiveChildContext";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, GripVertical, Users } from "lucide-react";
import { PILOT_MODE } from "@/config/pilot";
import { ConsentBanner } from "@/components/pilot/ConsentBanner";
import { isConsentRequiredError, throwForFailedResponse } from "@/lib/consentError";

const GRADES = [
  "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6",
  "Grade 7", "Grade 8", "Grade 9",
  "Form 1", "Form 2", "Form 3", "Form 4"
];

export function ChildrenManagement() {
  const { children, refetchChildren } = useActiveChild();
  const { toast } = useToast();

  const [consentNeeded, setConsentNeeded] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingChild, setEditingChild] = useState<Child | null>(null);
  const [childForm, setChildForm] = useState({ grade: "", schoolId: "", schoolName: "" });

  // Create child mutation
  const createChild = useMutation({
    mutationFn: async (data: { grade: string; schoolId: string | null; schoolName: string | null }) => {
      const response = await fetch("/api/children", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          grade: data.grade,
          schoolId: data.schoolId || null,
          schoolName: data.schoolName || null,
        }),
      });
      if (!response.ok) await throwForFailedResponse(response, "Failed to create child");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Child Added", description: "Successfully added child to your profile" });
      refetchChildren();
      setIsAddDialogOpen(false);
      setChildForm({ grade: "", schoolId: "", schoolName: "" });
    },
    onError: (error: any) => {
      if (isConsentRequiredError(error)) {
        setConsentNeeded(true);
        setIsAddDialogOpen(false);
        setIsEditDialogOpen(false);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update child mutation
  const updateChild = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Child> }) => {
      const response = await fetch(`/api/children/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!response.ok) await throwForFailedResponse(response, "Failed to update child");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Child Updated", description: "Successfully updated child information" });
      refetchChildren();
      setIsEditDialogOpen(false);
      setEditingChild(null);
    },
    onError: (error: any) => {
      if (isConsentRequiredError(error)) {
        setConsentNeeded(true);
        setIsAddDialogOpen(false);
        setIsEditDialogOpen(false);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete child mutation
  const deleteChild = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/children/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to delete child");
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Child Removed", description: "Child has been removed from your profile" });
      refetchChildren();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const handleAddChild = () => {
    if (!childForm.grade) {
      toast({ title: "Missing Grade", description: "Please select a grade", variant: "destructive" });
      return;
    }
    if (PILOT_MODE && !childForm.schoolId) {
      toast({ title: "Missing School", description: "Please select the school so we can build the booklist", variant: "destructive" });
      return;
    }
    createChild.mutate({
      grade: childForm.grade,
      schoolId: childForm.schoolId || null,
      schoolName: childForm.schoolName || null,
    });
  };

  const handleEditChild = (child: Child) => {
    setEditingChild(child);
    setChildForm({
      grade: child.grade,
      schoolId: child.schoolId || "",
      schoolName: child.schoolName || "",
    });
    setIsEditDialogOpen(true);
  };

  const handleUpdateChild = () => {
    if (!editingChild) return;
    updateChild.mutate({
      id: editingChild.id,
      data: {
        grade: childForm.grade,
        schoolId: childForm.schoolId || null,
        schoolName: childForm.schoolName || null,
      },
    });
  };

  const handleDeleteChild = (id: number, displayName: string) => {
    if (confirm(`Are you sure you want to remove ${displayName}?`)) {
      deleteChild.mutate(id);
    }
  };

  return (
    <>
      {consentNeeded && <ConsentBanner force />}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                My Children
              </CardTitle>
              <CardDescription>
                Manage your children to get personalized book recommendations
              </CardDescription>
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-2" />
              Add Child
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {children.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed rounded-lg">
              <Users className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
              <h3 className="font-medium mb-1">No children added yet</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Add your children to get personalized book recommendations and filter options
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)} variant="outline">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Child
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {children.map((child, index) => (
                <div
                  key={child.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-muted-foreground cursor-move" />
                    <div>
                      <div className="font-medium">{child.displayName}</div>
                      <div className="text-sm text-muted-foreground">{child.grade}</div>
                      {child.schoolName && (
                        <div className="text-xs text-muted-foreground">{child.schoolName}</div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleEditChild(child)}
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDeleteChild(child.id, child.displayName)}
                      disabled={deleteChild.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Child Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Child</DialogTitle>
            <DialogDescription>
              Add a child slot: just the grade and school, no name needed
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="child-grade">Grade *</Label>
              <Select value={childForm.grade} onValueChange={(value) => setChildForm({ ...childForm, grade: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  {GRADES.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="child-school">School (Optional)</Label>
              <SchoolCombobox
                value={childForm.schoolId}
                onChange={(schoolId, schoolName) => {
                  setChildForm({
                    ...childForm,
                    schoolId,
                    schoolName,
                  });
                }}
                placeholder="Select school"
              />
              <p className="text-xs text-muted-foreground">
                Select the school this child attends
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddChild} disabled={createChild.isPending}>
              {createChild.isPending ? "Adding..." : "Add Child"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Child Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Child</DialogTitle>
            <DialogDescription>Update your child's information</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-child-grade">Grade *</Label>
              <Select value={childForm.grade} onValueChange={(value) => setChildForm({ ...childForm, grade: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  {GRADES.map((grade) => (
                    <SelectItem key={grade} value={grade}>
                      {grade}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-child-school">School (Optional)</Label>
              <SchoolCombobox
                value={childForm.schoolId}
                initialSchoolName={childForm.schoolName}
                onChange={(schoolId, schoolName) => {
                  setChildForm({
                    ...childForm,
                    schoolId,
                    schoolName,
                  });
                }}
                placeholder="Select school"
              />
              <p className="text-xs text-muted-foreground">
                Select the school this child attends
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateChild} disabled={updateChild.isPending}>
              {updateChild.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
