// Firebase Task Management Module
import { db, getUserId } from "./firebase-config.js";
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
  increment,
  onSnapshot,
} from "firebase/firestore";

// Create a new task
export async function createTask(name, targetGoal) {
  const userId = getUserId();
  if (!userId) {
    console.error("❌ Cannot create task: User not authenticated");
    return null;
  }

  try {
    const taskId = `task_${Date.now()}`;
    const taskRef = doc(db, `users/${userId}/tasks/${taskId}`);

    const taskData = {
      id: taskId,
      name: name.trim(),
      targetGoal: parseInt(targetGoal),
      completed: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    await setDoc(taskRef, taskData);
    console.log("✅ Task created:", taskId);
    return { ...taskData, id: taskId };
  } catch (error) {
    console.error("❌ Failed to create task:", error);
    return null;
  }
}

// Get all tasks for the user
export async function getTasks() {
  const userId = getUserId();
  if (!userId) {
    console.error("❌ Cannot get tasks: User not authenticated");
    return [];
  }

  try {
    const tasksRef = collection(db, `users/${userId}/tasks`);
    const q = query(tasksRef, orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);

    const tasks = [];
    snapshot.forEach((doc) => {
      tasks.push({ id: doc.id, ...doc.data() });
    });

    console.log("✅ Loaded tasks:", tasks.length);
    return tasks;
  } catch (error) {
    console.error("❌ Failed to load tasks:", error);
    return [];
  }
}

// Subscribe to real-time task updates
export function subscribeToTasks(callback) {
  const userId = getUserId();
  if (!userId) {
    console.error("❌ Cannot subscribe to tasks: User not authenticated");
    return () => {};
  }

  try {
    const tasksRef = collection(db, `users/${userId}/tasks`);
    const q = query(tasksRef, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const tasks = [];
        snapshot.forEach((doc) => {
          tasks.push({ id: doc.id, ...doc.data() });
        });
        console.log("🔥 Tasks updated (real-time):", tasks.length);
        callback(tasks);
      },
      (error) => {
        console.error("❌ Task subscription error:", error);
      },
    );

    return unsubscribe;
  } catch (error) {
    console.error("❌ Failed to subscribe to tasks:", error);
    return () => {};
  }
}

// Increment task progress (called when Pomodoro completes)
export async function incrementTaskProgress(taskId) {
  const userId = getUserId();
  if (!userId) {
    console.error("❌ Cannot increment task: User not authenticated");
    return false;
  }

  try {
    const taskRef = doc(db, `users/${userId}/tasks/${taskId}`);

    await updateDoc(taskRef, {
      completed: increment(1),
      updatedAt: serverTimestamp(),
    });

    console.log("✅ Task progress incremented:", taskId);
    return true;
  } catch (error) {
    console.error("❌ Failed to increment task:", error);
    return false;
  }
}

// Delete a task
export async function deleteTask(taskId) {
  const userId = getUserId();
  if (!userId) {
    console.error("❌ Cannot delete task: User not authenticated");
    return false;
  }

  try {
    const taskRef = doc(db, `users/${userId}/tasks/${taskId}`);
    await deleteDoc(taskRef);
    console.log("✅ Task deleted:", taskId);
    return true;
  } catch (error) {
    console.error("❌ Failed to delete task:", error);
    return false;
  }
}

// Update task details
export async function updateTask(taskId, updates) {
  const userId = getUserId();
  if (!userId) {
    console.error("❌ Cannot update task: User not authenticated");
    return false;
  }

  try {
    const taskRef = doc(db, `users/${userId}/tasks/${taskId}`);
    await updateDoc(taskRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
    console.log("✅ Task updated:", taskId);
    return true;
  } catch (error) {
    console.error("❌ Failed to update task:", error);
    return false;
  }
}
