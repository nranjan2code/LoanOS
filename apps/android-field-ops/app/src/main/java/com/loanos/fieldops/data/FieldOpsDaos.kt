package com.loanos.fieldops.data

import androidx.room.*

@Dao
interface OfflineEnvelopeDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(envelope: OfflineEnvelopeEntity)

    @Query("SELECT * FROM offline_envelopes ORDER BY queuedAt ASC")
    suspend fun getAllEnvelopes(): List<OfflineEnvelopeEntity>

    @Query("SELECT * FROM offline_envelopes WHERE status = :status ORDER BY queuedAt ASC")
    suspend fun getEnvelopesByStatus(status: String): List<OfflineEnvelopeEntity>

    @Query("UPDATE offline_envelopes SET status = :status WHERE envelopeId = :id")
    suspend fun updateStatus(id: String, status: String)

    @Delete
    suspend fun delete(envelope: OfflineEnvelopeEntity)

    @Query("DELETE FROM offline_envelopes WHERE envelopeId = :id")
    suspend fun deleteById(id: String)
}

@Dao
interface AssignmentDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAll(assignments: List<AssignmentEntity>)

    @Query("SELECT * FROM assignments ORDER BY scheduledAt DESC")
    suspend fun getAllAssignments(): List<AssignmentEntity>

    @Query("SELECT * FROM assignments WHERE type = :type ORDER BY scheduledAt DESC")
    suspend fun getAssignmentsByType(type: String): List<AssignmentEntity>

    @Query("UPDATE assignments SET status = :status WHERE id = :id")
    suspend fun updateStatus(id: String, status: String)

    @Query("DELETE FROM assignments")
    suspend fun clearAll()
}
